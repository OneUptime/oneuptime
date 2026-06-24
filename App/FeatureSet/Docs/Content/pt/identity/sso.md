# SSO (Single Sign-On)

O OneUptime suporta Single Sign-On (SSO) baseado em SAML 2.0 para autenticação empresarial. O SSO permite que os membros da sua equipe façam login no OneUptime usando as credenciais do provedor de identidade (IdP) da sua organização, fornecendo gerenciamento centralizado de acesso e segurança aprimorada.

## Visão Geral

A integração SSO oferece os seguintes benefícios:

- **Autenticação Centralizada**: Os usuários fazem login com suas credenciais corporativas existentes
- **Segurança Aprimorada**: Aproveite a autenticação multifator e as políticas de segurança do seu IdP
- **Gerenciamento Simplificado de Usuários**: Gerencie o acesso a partir do seu sistema de gerenciamento de identidade existente
- **Fadiga de Senhas Reduzida**: Os usuários não precisam lembrar uma senha separada do OneUptime

## Configurando o SSO

1. **Navegar para as Configurações do Projeto**

   - Vá para o seu projeto do OneUptime
   - Navegue para **Project Settings** > **Authentication** > **SSO**

2. **Criar Configuração SSO**

   - Clique em **Create SSO**
   - Insira um **Nome** para a configuração SSO (ex.: "Keycloak SAML" ou "Okta SAML")
   - Insira a **Sign On URL** do seu provedor de identidade
   - Insira o **Issuer** (Entity ID) do seu provedor de identidade
   - Cole o **Public Certificate** do seu provedor de identidade
   - Selecione o **Signature Algorithm** (ex.: `RSA-SHA-256`)
   - Selecione o **Digest Algorithm** (ex.: `SHA256`)

3. **Obter Metadados SSO do OneUptime**
   - Após salvar, clique no botão **View SSO Config**
   - Copie o **Identifier (Entity ID)** — isso é necessário na configuração do seu IdP
   - Copie o **Reply URL (Assertion Consumer Service URL)** — isso é necessário na configuração do seu IdP

## Configuração do Keycloak SAML

O Keycloak é uma solução popular de código aberto para gerenciamento de identidade e acesso. Siga estas etapas para configurar o Keycloak como seu provedor de identidade SAML para o OneUptime.

### Pré-requisitos

- Uma instância do Keycloak em execução com um realm configurado
- Acesso de administrador ao Keycloak e ao OneUptime
- Conta do OneUptime com suporte a SSO

### Passo 1: Configurar o SSO do OneUptime

1. Faça login no seu painel do OneUptime
2. Navegue para **Project Settings** > **Authentication** > **SSO**
3. Clique em **Create SSO** e preencha o seguinte:
   - **Nome**: Um nome descritivo (ex.: `my-project-oneuptime`)
   - **Sign On URL**: `https://<seu-dominio-keycloak>/auth/realms/<seu-realm>/protocol/saml`
   - **Issuer**: `https://<seu-dominio-keycloak>/auth/realms/<seu-realm>`
   - **Certificate**: Consulte o [Passo 2](#passo-2-obter-o-certificado-do-keycloak) abaixo
   - **Signature Algorithm**: `RSA-SHA-256`
   - **Digest Algorithm**: `SHA256`
4. Salve a configuração

### Passo 2: Obter o Certificado do Keycloak

1. No Keycloak, navegue para a configuração do seu cliente
2. Clique em **Export** (ou vá para a aba **Keys** dependendo da sua versão do Keycloak)
3. No arquivo JSON exportado, encontre a chave com `certificate` no nome
4. Copie o valor do certificado e cole-o no OneUptime no seguinte formato:

```
-----BEGIN CERTIFICATE-----
MIICnzCCAYcCBgFyPZ8QFzANBgkqhkiG.......
-----END CERTIFICATE-----
```

### Passo 3: Configurar o Cliente Keycloak

1. No Keycloak, navegue para **Clients** no seu realm
2. Crie um novo cliente ou edite um existente
3. Defina **Client Protocol** como `saml`
4. Defina **Client ID** como o valor de **Identifier (Entity ID)** do **View SSO Config** do OneUptime
5. Defina **Valid Redirect URIs** para a sua URL do OneUptime
6. Defina **Root URL** para a URL base do OneUptime
7. Cole o **Reply URL (Assertion Consumer Service URL)** do OneUptime no campo **Assertion Consumer Service POST Binding URL**

### Passo 4: Configurar as Definições do Cliente Keycloak

1. Desabilite **Signing keys config** (na aba Keys)
2. Defina **Name ID Format** como `email`
3. Certifique-se de que a opção **Force Name ID Format** está habilitada para que o Keycloak sempre envie o email como o Name ID

### Passo 5: Verificar a Configuração

1. Salve todas as configurações no Keycloak e no OneUptime
2. Tente fazer login no OneUptime usando SSO
3. Você deve ser redirecionado para a página de login do Keycloak e de volta ao OneUptime após autenticação bem-sucedida

### Solução de Problemas do Keycloak

- **Login Fails with Signature Error**: Certifique-se de que o certificado foi copiado corretamente, incluindo as linhas `BEGIN CERTIFICATE` e `END CERTIFICATE`
- **Name ID Error**: Verifique se **Name ID Format** está definido como `email` no Keycloak
- **Redirect Loop**: Verifique se **Valid Redirect URIs** e **Assertion Consumer Service POST Binding URL** estão configurados corretamente
- **Certificate Not Found**: Certifique-se de que você está exportando do cliente correto no realm correto

---

## Configuração SAML do Microsoft Entra ID (anteriormente Azure AD / Active Directory)

O Microsoft Entra ID é o serviço de gerenciamento de identidade e acesso baseado em nuvem da Microsoft. Siga estas etapas para configurar o Entra ID como seu provedor de identidade SAML para o OneUptime.

### Pré-requisitos

- Tenant do Microsoft Entra ID (qualquer nível que suporte aplicativos empresariais com SSO SAML)
- Acesso de administrador ao Microsoft Entra ID e ao OneUptime
- Conta do OneUptime com suporte a SSO

### Passo 1: Configurar o SSO do OneUptime

1. Faça login no seu painel do OneUptime
2. Navegue para **Project Settings** > **Authentication** > **SSO**
3. Clique em **Create SSO** e preencha o seguinte:
   - **Nome**: Um nome descritivo (ex.: `Azure AD SAML`)
   - **Sign On URL**: Você obterá isso do Entra ID no [Passo 3](#passo-3-copiar-metadados-saml-do-entra-id-para-o-oneuptime)
   - **Issuer**: Você obterá isso do Entra ID no [Passo 3](#passo-3-copiar-metadados-saml-do-entra-id-para-o-oneuptime)
   - **Certificate**: Você obterá isso do Entra ID no [Passo 3](#passo-3-copiar-metadados-saml-do-entra-id-para-o-oneuptime)
   - **Signature Algorithm**: `RSA-SHA-256`
   - **Digest Algorithm**: `SHA256`
4. Clique em **View SSO Config** e copie o **Identifier (Entity ID)** e o **Reply URL (Assertion Consumer Service URL)** — você precisará desses para o Entra ID

### Passo 2: Criar Aplicativo Empresarial no Microsoft Entra ID

1. Faça login no [centro de administração do Microsoft Entra](https://entra.microsoft.com)
2. Navegue para **Identity** > **Applications** > **Enterprise applications**
3. Clique em **+ New application**
4. Clique em **+ Create your own application**
5. Insira um nome (ex.: "OneUptime")
6. Selecione **Integrate any other application you don't find in the gallery (Non-gallery)**
7. Clique em **Create**

### Passo 3: Configurar o SSO SAML no Entra ID

1. No seu novo aplicativo empresarial, vá para **Single sign-on**
2. Selecione **SAML** como o método de single sign-on
3. Em **Basic SAML Configuration**, clique em **Edit** e defina:
   - **Identifier (Entity ID)**: Cole o **Identifier (Entity ID)** do **View SSO Config** do OneUptime
   - **Reply URL (Assertion Consumer Service URL)**: Cole o **Reply URL** do **View SSO Config** do OneUptime
4. Clique em **Save**
5. Na seção **SAML Certificates**:
   - Faça o download do **Certificate (Base64)**
   - Abra o arquivo de certificado baixado em um editor de texto e copie o conteúdo
6. Na seção **Set up OneUptime**, copie:
   - **Login URL** — cole isso como o **Sign On URL** no OneUptime
   - **Azure AD Identifier** — cole isso como o **Issuer** no OneUptime
7. Volte ao OneUptime e cole o certificado e as URLs, depois salve

### Passo 4: Configurar Atributos de Usuário e Declarações

1. Na página de configuração SAML, clique em **Edit** em **Attributes & Claims**
2. Certifique-se de que as seguintes declarações estão configuradas:

| Nome da Declaração                                                   | Valor                                   |
| -------------------------------------------------------------------- | --------------------------------------- |
| `Unique User Identifier (Name ID)`                                   | `user.userprincipalname` ou `user.mail` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` | `user.mail`                             |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname`    | `user.givenname`                        |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname`      | `user.surname`                          |

3. Defina o **Name identifier format** como `Email address`
4. Clique em **Save**

### Passo 5: Atribuir Usuários e Grupos

1. No seu aplicativo empresarial, vá para **Users and groups**
2. Clique em **+ Add user/group**
3. Selecione os usuários e/ou grupos aos quais deseja conceder acesso SSO
4. Clique em **Assign**

### Passo 6: Verificar a Configuração

1. Salve todas as configurações no Entra ID e no OneUptime
2. Tente fazer login no OneUptime usando SSO
3. Você deve ser redirecionado para a página de login da Microsoft e de volta ao OneUptime após autenticação bem-sucedida

### Solução de Problemas do Microsoft Entra ID

- **AADSTS700016 Error**: O Identifier (Entity ID) no Entra ID não corresponde ao OneUptime — verifique se ambos os valores são idênticos
- **Certificate Error**: Certifique-se de que você fez o download do certificado **Base64** (não o formato raw/binário) e incluiu as linhas `BEGIN CERTIFICATE` / `END CERTIFICATE`
- **User Not Assigned**: Os usuários devem ser explicitamente atribuídos ao aplicativo empresarial antes de poderem fazer login via SSO
- **Name ID Mismatch**: Certifique-se de que a declaração Name ID está definida como um endereço de email que corresponde ao email do usuário no OneUptime

---

## Configuração SAML do Okta

O Okta é uma plataforma de identidade amplamente utilizada que fornece capacidades robustas de SSO SAML. Siga estas etapas para configurar o Okta como seu provedor de identidade SAML para o OneUptime.

### Pré-requisitos

- Organização Okta com acesso de administrador
- Conta do OneUptime com suporte a SSO

### Passo 1: Configurar o SSO do OneUptime

1. Faça login no seu painel do OneUptime
2. Navegue para **Project Settings** > **Authentication** > **SSO**
3. Clique em **Create SSO** e preencha o seguinte:
   - **Nome**: Um nome descritivo (ex.: `Okta SAML`)
   - **Sign On URL**: Você obterá isso do Okta no [Passo 3](#passo-3-copiar-metadados-saml-do-okta-para-o-oneuptime)
   - **Issuer**: Você obterá isso do Okta no [Passo 3](#passo-3-copiar-metadados-saml-do-okta-para-o-oneuptime)
   - **Certificate**: Você obterá isso do Okta no [Passo 3](#passo-3-copiar-metadados-saml-do-okta-para-o-oneuptime)
   - **Signature Algorithm**: `RSA-SHA-256`
   - **Digest Algorithm**: `SHA256`
4. Clique em **View SSO Config** e copie o **Identifier (Entity ID)** e o **Reply URL (Assertion Consumer Service URL)** — você precisará desses para o Okta

### Passo 2: Criar Aplicativo SAML no Okta

1. Faça login no Console de Administração do Okta
2. Navegue para **Applications** > **Applications**
3. Clique em **Create App Integration**
4. Selecione **SAML 2.0** e clique em **Next**
5. Insira "OneUptime" como o **App name** e clique em **Next**
6. Na seção **SAML Settings**, configure:
   - **Single sign-on URL**: Cole o **Reply URL (Assertion Consumer Service URL)** do **View SSO Config** do OneUptime
   - **Audience URI (SP Entity ID)**: Cole o **Identifier (Entity ID)** do **View SSO Config** do OneUptime
   - **Name ID format**: Selecione `EmailAddress`
   - **Application username**: Selecione `Email`
7. Clique em **Next**, depois selecione **I'm an Okta customer adding an internal app** e clique em **Finish**

### Passo 3: Copiar Metadados SAML do Okta para o OneUptime

1. No seu aplicativo Okta, vá para a aba **Sign On**
2. Na seção **SAML Signing Certificates**, encontre o certificado ativo e clique em **Actions** > **View IdP metadata**
3. A partir do XML de metadados ou dos detalhes da aba **Sign On**:
   - Copie a **Sign On URL** (também chamada de **Identity Provider Single Sign-On URL**) — cole isso como o **Sign On URL** no OneUptime
   - Copie o **Issuer** (também chamado de **Identity Provider Issuer**) — cole isso como o **Issuer** no OneUptime
4. Faça o download do certificado de assinatura:
   - Na seção **SAML Signing Certificates**, clique em **Actions** > **Download certificate** para o certificado ativo
   - Abra o arquivo `.cert` baixado em um editor de texto e copie o conteúdo
   - Cole o certificado no OneUptime (incluindo as linhas `BEGIN CERTIFICATE` e `END CERTIFICATE`)
5. Salve a configuração SSO do OneUptime

### Passo 4: Configurar Declarações de Atributo (Opcional)

1. No aplicativo Okta, vá para a aba **General**
2. Clique em **Edit** na seção **SAML Settings** e clique em **Next** para chegar às configurações SAML
3. Na seção **Attribute Statements**, adicione:

| Nome        | Valor            |
| ----------- | ---------------- |
| `email`     | `user.email`     |
| `firstName` | `user.firstName` |
| `lastName`  | `user.lastName`  |

4. Clique em **Next** e depois em **Finish**

### Passo 5: Atribuir Usuários e Grupos

1. No seu aplicativo Okta, vá para a aba **Assignments**
2. Clique em **Assign** > **Assign to People** ou **Assign to Groups**
3. Selecione os usuários ou grupos aos quais deseja conceder acesso SSO
4. Clique em **Assign** para cada seleção, depois clique em **Done**

### Passo 6: Verificar a Configuração

1. Salve todas as configurações no Okta e no OneUptime
2. Tente fazer login no OneUptime usando SSO
3. Você deve ser redirecionado para a página de login do Okta e de volta ao OneUptime após autenticação bem-sucedida

### Solução de Problemas do Okta

- **404 or Invalid SSO URL**: Verifique se a **Single sign-on URL** no Okta corresponde exatamente ao **Reply URL** do OneUptime
- **Audience Mismatch**: Certifique-se de que o **Audience URI** no Okta corresponde exatamente ao **Identifier (Entity ID)** do OneUptime
- **Certificate Error**: Certifique-se de que você fez o download do certificado para o certificado de assinatura **ativo**, não um inativo
- **User Not Assigned**: Os usuários devem ser atribuídos ao aplicativo Okta antes de poderem fazer login via SSO
- **Name ID Error**: Verifique se **Name ID format** está definido como `EmailAddress` e **Application username** está definido como `Email`

---

## Outros Provedores de Identidade

A implementação SSO do OneUptime usa o protocolo SAML 2.0 e deve funcionar com qualquer provedor de identidade compatível. As etapas gerais de configuração são:

1. No OneUptime, crie uma configuração SSO e anote o **Identifier (Entity ID)** e o **Reply URL (Assertion Consumer Service URL)** do botão **View SSO Config**
2. No seu provedor de identidade, crie um aplicativo SAML usando:
   - **Assertion Consumer Service URL / Reply URL**: Da configuração SSO do OneUptime
   - **Entity ID / Audience URI**: Da configuração SSO do OneUptime
   - **Name ID Format**: Endereço de email
3. Do seu provedor de identidade, copie o seguinte para o OneUptime:
   - **Sign On URL** (endpoint SSO)
   - **Issuer** (Entity ID do IdP)
   - **Public Certificate** (certificado de assinatura X.509)
4. Defina o **Signature Algorithm** como `RSA-SHA-256` e **Digest Algorithm** como `SHA256`

## Notas sobre SSO e Funções

O OneUptime atualmente não suporta o mapeamento de funções SAML do seu provedor de identidade. O acesso baseado em funções deve ser configurado separadamente nas **Project Settings** > **SSO** do OneUptime, onde você pode atribuir funções padrão para usuários SSO.
