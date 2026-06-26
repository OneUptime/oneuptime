# SCIM (System for Cross-domain Identity Management)

O OneUptime suporta o protocolo SCIM v2.0 para provisionamento e desprovisionamento automatizado de usuários. O SCIM permite que provedores de identidade (IdPs) como Azure AD, Okta e outros sistemas de identidade empresariais gerenciem automaticamente o acesso de usuários a projetos e páginas de status do OneUptime.

## Visão Geral

A integração SCIM oferece os seguintes benefícios:

- **Provisionamento Automatizado de Usuários**: Criar automaticamente usuários no OneUptime quando eles são atribuídos no seu IdP
- **Desprovisionamento Automatizado de Usuários**: Remover automaticamente usuários do OneUptime quando eles são desatribuídos no seu IdP
- **Sincronização de Atributos de Usuário**: Manter as informações do usuário sincronizadas entre seu IdP e o OneUptime
- **Gerenciamento Centralizado de Acesso**: Gerenciar o acesso ao OneUptime a partir do seu sistema de gerenciamento de identidade existente

## SCIM para Projetos

O SCIM de Projeto permite que provedores de identidade gerenciem membros de equipes em projetos do OneUptime.

### Configurando o SCIM de Projeto

1. **Navegar para as Configurações do Projeto**

   - Vá para o seu projeto do OneUptime
   - Navegue para **Project Settings** > **Team** > **SCIM**

2. **Configurar as Definições SCIM**

   - Habilite **Auto Provision Users** para adicionar automaticamente usuários quando eles são atribuídos no seu IdP
   - Habilite **Auto Deprovision Users** para remover automaticamente usuários quando eles são desatribuídos no seu IdP
   - Selecione as **Default Teams** às quais os novos usuários devem ser adicionados
   - Copie a **SCIM Base URL** e o **Bearer Token** para a configuração do seu IdP

3. **Configurar Seu Provedor de Identidade**
   - Use a SCIM Base URL: `https://oneuptime.com/scim/v2/{scimId}`
   - Configure a autenticação com token bearer usando o token fornecido
   - Mapeie os atributos do usuário (email é obrigatório)

### Endpoints de SCIM de Projeto

- **Service Provider Config**: `GET /scim/v2/{scimId}/ServiceProviderConfig`
- **Schemas**: `GET /scim/v2/{scimId}/Schemas`
- **Resource Types**: `GET /scim/v2/{scimId}/ResourceTypes`
- **List Users**: `GET /scim/v2/{scimId}/Users`
- **Get User**: `GET /scim/v2/{scimId}/Users/{userId}`
- **Create User**: `POST /scim/v2/{scimId}/Users`
- **Update User**: `PUT /scim/v2/{scimId}/Users/{userId}` ou `PATCH /scim/v2/{scimId}/Users/{userId}`
- **Delete User**: `DELETE /scim/v2/{scimId}/Users/{userId}`
- **List Groups**: `GET /scim/v2/{scimId}/Groups`
- **Get Group**: `GET /scim/v2/{scimId}/Groups/{groupId}`
- **Create Group**: `POST /scim/v2/{scimId}/Groups`
- **Update Group**: `PUT /scim/v2/{scimId}/Groups/{groupId}` ou `PATCH /scim/v2/{scimId}/Groups/{groupId}`
- **Delete Group**: `DELETE /scim/v2/{scimId}/Groups/{groupId}`

### Ciclo de Vida do Usuário no SCIM de Projeto

1. **Atribuição de Usuário no IdP**: Quando um usuário é atribuído ao OneUptime no seu IdP
2. **Provisionamento SCIM**: O IdP chama a API SCIM do OneUptime para criar o usuário
3. **Adesão à Equipe**: O usuário é automaticamente adicionado às equipes padrão configuradas
4. **Acesso Concedido**: O usuário agora pode acessar o projeto do OneUptime
5. **Desatribuição do Usuário**: Quando o usuário é desatribuído no IdP
6. **Desprovisionamento SCIM**: O IdP chama a API SCIM do OneUptime para remover o usuário
7. **Acesso Revogado**: O usuário perde acesso ao projeto

## SCIM para Páginas de Status

O SCIM de Página de Status permite que provedores de identidade gerenciem assinantes de páginas de status privadas.

### Configurando o SCIM de Página de Status

1. **Navegar para as Configurações da Página de Status**

   - Vá para a sua página de status do OneUptime
   - Navegue para **Status Page Settings** > **Private Users** > **SCIM**

2. **Configurar as Definições SCIM**

   - Habilite **Auto Provision Users** para adicionar automaticamente assinantes quando eles são atribuídos no seu IdP
   - Habilite **Auto Deprovision Users** para remover automaticamente assinantes quando eles são desatribuídos no seu IdP
   - Copie a **SCIM Base URL** e o **Bearer Token** para a configuração do seu IdP

3. **Configurar Seu Provedor de Identidade**
   - Use a SCIM Base URL: `https://oneuptime.com/status-page-scim/v2/{scimId}`
   - Configure a autenticação com token bearer usando o token fornecido
   - Mapeie os atributos do usuário (email é obrigatório)

### Endpoints de SCIM de Página de Status

- **Service Provider Config**: `GET /status-page-scim/v2/{scimId}/ServiceProviderConfig`
- **Schemas**: `GET /status-page-scim/v2/{scimId}/Schemas`
- **Resource Types**: `GET /status-page-scim/v2/{scimId}/ResourceTypes`
- **List Users**: `GET /status-page-scim/v2/{scimId}/Users`
- **Get User**: `GET /status-page-scim/v2/{scimId}/Users/{userId}`
- **Create User**: `POST /status-page-scim/v2/{scimId}/Users`
- **Update User**: `PUT /status-page-scim/v2/{scimId}/Users/{userId}` ou `PATCH /status-page-scim/v2/{scimId}/Users/{userId}`
- **Delete User**: `DELETE /status-page-scim/v2/{scimId}/Users/{userId}`

### Ciclo de Vida do Usuário no SCIM de Página de Status

1. **Atribuição de Usuário no IdP**: Quando um usuário é atribuído à Página de Status do OneUptime no seu IdP
2. **Provisionamento SCIM**: O IdP chama a API SCIM do OneUptime para criar o assinante
3. **Acesso Concedido**: O usuário agora pode acessar a página de status privada
4. **Desatribuição do Usuário**: Quando o usuário é desatribuído no IdP
5. **Desprovisionamento SCIM**: O IdP chama a API SCIM do OneUptime para remover o assinante
6. **Acesso Revogado**: O usuário perde acesso à página de status

## Configuração do Provedor de Identidade

### Microsoft Entra ID (anteriormente Azure AD)

O Microsoft Entra ID fornece gerenciamento de identidade empresarial com recursos robustos de provisionamento SCIM. Siga estas etapas detalhadas para configurar o provisionamento SCIM com o OneUptime.

#### Pré-requisitos

- Tenant do Microsoft Entra ID com licença Premium P1 ou P2 (necessário para provisionamento automático)
- Conta do OneUptime com plano Scale ou superior
- Acesso de administrador ao Microsoft Entra ID e ao OneUptime

#### Passo 1: Obter Configuração SCIM do OneUptime

1. Faça login no seu painel do OneUptime
2. Navegue para **Project Settings** > **Team** > **SCIM**
3. Clique em **Create SCIM Configuration**
4. Insira um nome amigável (ex.: "Microsoft Entra ID Provisioning")
5. Configure as seguintes opções:
   - **Auto Provision Users**: Habilite para criar usuários automaticamente
   - **Auto Deprovision Users**: Habilite para remover usuários automaticamente
   - **Default Teams**: Selecione equipes às quais novos usuários devem ser adicionados
   - **Enable Push Groups**: Habilite se quiser gerenciar a adesão à equipe via grupos do Entra ID
6. Salve a configuração
7. Copie a **SCIM Base URL** e o **Bearer Token** — você precisará desses para o Entra ID

#### Passo 2: Criar Aplicativo Empresarial no Microsoft Entra ID

1. Faça login no [centro de administração do Microsoft Entra](https://entra.microsoft.com)
2. Navegue para **Identity** > **Applications** > **Enterprise applications**
3. Clique em **+ New application**
4. Clique em **+ Create your own application**
5. Insira um nome (ex.: "OneUptime")
6. Selecione **Integrate any other application you don't find in the gallery (Non-gallery)**
7. Clique em **Create**

#### Passo 3: Configurar o Provisionamento SCIM

1. No seu aplicativo empresarial do OneUptime, vá para **Provisioning**
2. Clique em **Get started**
3. Defina **Provisioning Mode** como **Automatic**
4. Em **Admin Credentials**:
   - **Tenant URL**: Insira a SCIM Base URL do OneUptime (ex.: `https://oneuptime.com/api/identity/scim/v2/{seu-scim-id}`)
   - **Secret Token**: Insira o Bearer Token do OneUptime
5. Clique em **Test Connection** para verificar a configuração
6. Clique em **Save**

#### Passo 4: Configurar Mapeamentos de Atributos

1. Na seção Provisioning, clique em **Mappings**
2. Clique em **Provision Azure Active Directory Users**
3. Configure os seguintes mapeamentos de atributos:

| Atributo do Azure AD                                          | Atributo SCIM do OneUptime     | Obrigatório |
| ------------------------------------------------------------- | ------------------------------ | ----------- |
| `userPrincipalName`                                           | `userName`                     | Sim         |
| `mail`                                                        | `emails[type eq "work"].value` | Recomendado |
| `displayName`                                                 | `displayName`                  | Recomendado |
| `givenName`                                                   | `name.givenName`               | Opcional    |
| `surname`                                                     | `name.familyName`              | Opcional    |
| `Switch([IsSoftDeleted], , "False", "True", "True", "False")` | `active`                       | Recomendado |

4. Remova quaisquer mapeamentos desnecessários para simplificar o provisionamento
5. Clique em **Save**

#### Passo 5: Configurar o Provisionamento de Grupos (Opcional)

Se você habilitou **Push Groups** no OneUptime:

1. Volte para **Mappings**
2. Clique em **Provision Azure Active Directory Groups**
3. Habilite o provisionamento de grupos definindo **Enabled** como **Yes**
4. Configure os seguintes mapeamentos de atributos:

| Atributo do Azure AD | Atributo SCIM do OneUptime |
| -------------------- | -------------------------- |
| `displayName`        | `displayName`              |
| `members`            | `members`                  |

5. Clique em **Save**

#### Passo 6: Atribuir Usuários e Grupos

1. No seu aplicativo empresarial do OneUptime, vá para **Users and groups**
2. Clique em **+ Add user/group**
3. Selecione os usuários e/ou grupos que deseja provisionar para o OneUptime
4. Clique em **Assign**

#### Passo 7: Iniciar o Provisionamento

1. Vá para **Provisioning** > **Overview**
2. Clique em **Start provisioning**
3. O ciclo de provisionamento inicial começará (isso pode levar até 40 minutos para a primeira sincronização)
4. Monitore os **Provisioning logs** para quaisquer erros

#### Solução de Problemas do Microsoft Entra ID

- **Test Connection Fails**: Verifique se a SCIM Base URL inclui o prefixo `/api/identity` e se o Bearer Token está correto
- **Users Not Provisioning**: Verifique se os usuários estão atribuídos ao aplicativo e os mapeamentos de atributos estão corretos
- **Provisioning Errors**: Revise os logs de Provisionamento no Entra ID para mensagens de erro específicas
- **Sync Delays**: O provisionamento inicial pode levar até 40 minutos; sincronizações subsequentes ocorrem a cada 40 minutos

---

### Okta

O Okta fornece gerenciamento de identidade flexível com excelente suporte a SCIM. Siga estas etapas detalhadas para configurar o provisionamento SCIM com o OneUptime.

#### Pré-requisitos

- Tenant do Okta com capacidades de provisionamento (recurso de Lifecycle Management)
- Conta do OneUptime com plano Scale ou superior
- Acesso de administrador ao Okta e ao OneUptime

#### Passo 1: Obter Configuração SCIM do OneUptime

1. Faça login no seu painel do OneUptime
2. Navegue para **Project Settings** > **Team** > **SCIM**
3. Clique em **Create SCIM Configuration**
4. Insira um nome amigável (ex.: "Okta Provisioning")
5. Configure as seguintes opções:
   - **Auto Provision Users**: Habilite para criar usuários automaticamente
   - **Auto Deprovision Users**: Habilite para remover usuários automaticamente
   - **Default Teams**: Selecione equipes às quais novos usuários devem ser adicionados
   - **Enable Push Groups**: Habilite se quiser gerenciar a adesão à equipe via grupos do Okta
6. Salve a configuração
7. Copie a **SCIM Base URL** e o **Bearer Token** — você precisará desses para o Okta

#### Passo 2: Criar ou Configurar o Aplicativo Okta

**Se você tiver um aplicativo SSO existente:**

1. Faça login no Console de Administração do Okta
2. Navegue para **Applications** > **Applications**
3. Encontre e selecione seu aplicativo OneUptime existente

**Se estiver criando um novo aplicativo:**

1. Faça login no Console de Administração do Okta
2. Navegue para **Applications** > **Applications**
3. Clique em **Create App Integration**
4. Selecione **SAML 2.0** e clique em **Next**
5. Insira "OneUptime" como o nome do aplicativo
6. Conclua a configuração SAML (consulte a documentação de SSO)
7. Clique em **Finish**

#### Passo 3: Habilitar o Provisionamento SCIM

1. No seu aplicativo OneUptime, vá para a aba **General**
2. Na seção **App Settings**, clique em **Edit**
3. Em **Provisioning**, selecione **SCIM**
4. Clique em **Save**
5. Uma nova aba **Provisioning** aparecerá

#### Passo 4: Configurar a Conexão SCIM

1. Vá para a aba **Provisioning**
2. Clique em **Integration** na barra lateral esquerda
3. Clique em **Configure API Integration**
4. Marque **Enable API integration**
5. Configure o seguinte:
   - **SCIM connector base URL**: Insira a SCIM Base URL do OneUptime (ex.: `https://oneuptime.com/api/identity/scim/v2/{seu-scim-id}`)
   - **Unique identifier field for users**: Insira `userName`
   - **Supported provisioning actions**: Selecione as ações que deseja habilitar:
     - Import New Users and Profile Updates
     - Push New Users
     - Push Profile Updates
     - Push Groups (se usar provisionamento baseado em grupo)
   - **Authentication Mode**: Selecione **HTTP Header**
   - **Authorization**: Insira `Bearer {seu-bearer-token}` (substitua pelo token real)
6. Clique em **Test API Credentials** para verificar a conexão
7. Clique em **Save**

#### Passo 5: Configurar o Provisionamento para o Aplicativo

1. Na aba **Provisioning**, clique em **To App** na barra lateral esquerda
2. Clique em **Edit**
3. Habilite as seguintes opções:
   - **Create Users**: Habilite para provisionar novos usuários
   - **Update User Attributes**: Habilite para sincronizar alterações de atributos
   - **Deactivate Users**: Habilite para desprovisionar usuários quando desatribuídos
4. Clique em **Save**

#### Passo 6: Configurar Mapeamentos de Atributos

1. Role para baixo até **Attribute Mappings**
2. Verifique ou configure os seguintes mapeamentos:

| Atributo do Okta   | Atributo SCIM do OneUptime      | Direção              |
| ------------------ | ------------------------------- | -------------------- |
| `userName`         | `userName`                      | Okta para Aplicativo |
| `user.email`       | `emails[primary eq true].value` | Okta para Aplicativo |
| `user.firstName`   | `name.givenName`                | Okta para Aplicativo |
| `user.lastName`    | `name.familyName`               | Okta para Aplicativo |
| `user.displayName` | `displayName`                   | Okta para Aplicativo |

3. Remova quaisquer mapeamentos desnecessários
4. Clique em **Save** se fizer alterações

#### Passo 7: Configurar Push de Grupos (Opcional)

Se você habilitou **Push Groups** no OneUptime:

1. Vá para a aba **Push Groups**
2. Clique em **+ Push Groups**
3. Selecione **Find groups by name** ou **Find groups by rule**
4. Pesquise e selecione os grupos que deseja enviar
5. Clique em **Save**

#### Passo 8: Atribuir Usuários

1. Vá para a aba **Assignments**
2. Clique em **Assign** > **Assign to People** ou **Assign to Groups**
3. Selecione os usuários ou grupos que deseja provisionar
4. Clique em **Assign** para cada seleção
5. Clique em **Done**

#### Passo 9: Verificar o Provisionamento

1. Vá para **Reports** > **System Log** no Console de Administração do Okta
2. Filtre eventos relacionados ao seu aplicativo OneUptime
3. Verifique se os eventos de provisionamento foram bem-sucedidos
4. Verifique no OneUptime se os usuários foram criados

#### Solução de Problemas do Okta

- **API Credentials Test Fails**: Verifique se a SCIM Base URL e o Bearer Token estão corretos
- **Users Not Provisioning**: Certifique-se de que os usuários estão atribuídos ao aplicativo e o provisionamento está habilitado
- **Duplicate Users**: Certifique-se de que o atributo `userName` é único e mapeia corretamente para o email
- **Group Push Failures**: Verifique se os grupos existem e têm a adesão correta
- **Error: 401 Unauthorized**: Regenere o Bearer Token no OneUptime e atualize no Okta

---

### Outros Provedores de Identidade

A implementação SCIM do OneUptime segue a especificação SCIM v2.0 e deve funcionar com qualquer provedor de identidade compatível. Etapas gerais de configuração:

1. **SCIM Base URL**: `https://oneuptime.com/api/identity/scim/v2/{scim-id}` (para projetos) ou `https://oneuptime.com/api/identity/status-page-scim/v2/{scim-id}` (para páginas de status)
2. **Autenticação**: HTTP Bearer Token
3. **Atributo de Usuário Obrigatório**: `userName` (deve ser um endereço de email válido)
4. **Operações Suportadas**: GET, POST, PUT, PATCH, DELETE para Usuários e Grupos

#### Endpoints SCIM Suportados

| Endpoint                 | Métodos                 | Descrição                                               |
| ------------------------ | ----------------------- | ------------------------------------------------------- |
| `/ServiceProviderConfig` | GET                     | Capacidades do servidor SCIM                            |
| `/Schemas`               | GET                     | Esquemas de recursos disponíveis                        |
| `/ResourceTypes`         | GET                     | Tipos de recursos disponíveis                           |
| `/Users`                 | GET, POST               | Listar e criar usuários                                 |
| `/Users/{id}`            | GET, PUT, PATCH, DELETE | Gerenciar usuários individuais                          |
| `/Groups`                | GET, POST               | Listar e criar grupos/equipes (somente SCIM de Projeto) |
| `/Groups/{id}`           | GET, PUT, PATCH, DELETE | Gerenciar grupos individuais (somente SCIM de Projeto)  |

#### Esquema de Usuário SCIM

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "user@example.com",
  "name": {
    "givenName": "John",
    "familyName": "Doe",
    "formatted": "John Doe"
  },
  "displayName": "John Doe",
  "emails": [
    {
      "value": "user@example.com",
      "type": "work",
      "primary": true
    }
  ],
  "active": true
}
```

#### Esquema de Grupo SCIM

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "displayName": "Engineering Team",
  "members": [
    {
      "value": "user-id-here",
      "display": "user@example.com"
    }
  ]
}
```

## Perguntas Frequentes

### O que acontece quando um usuário é desprovisionado?

Quando um usuário é desprovisionado (seja por solicitação DELETE ou definindo `active: false`), ele é removido das equipes configuradas nas definições SCIM. A conta de usuário em si permanece no OneUptime, mas perde acesso ao projeto.

### Posso usar SCIM sem SSO?

Sim, SCIM e SSO são recursos independentes. Você pode usar SCIM para provisionamento de usuários enquanto permite que os usuários façam login com suas senhas do OneUptime ou qualquer outro método de autenticação.

### Como lidar com usuários que já existem no OneUptime?

Quando o SCIM tenta criar um usuário que já existe (correspondendo por email), o OneUptime simplesmente os adicionará às equipes padrão configuradas em vez de criar um usuário duplicado.

### Qual é a diferença entre equipes padrão e push de grupos?

- **Default Teams**: Todos os usuários provisionados via SCIM são adicionados às mesmas equipes predefinidas
- **Push Groups**: A adesão à equipe é gerenciada pelo seu provedor de identidade, permitindo que diferentes usuários estejam em diferentes equipes com base na adesão ao grupo do IdP

### Com que frequência ocorre a sincronização de provisionamento?

Isso depende do seu provedor de identidade:

- **Microsoft Entra ID**: A sincronização inicial pode levar até 40 minutos; sincronizações subsequentes a cada 40 minutos
- **Okta**: Quase em tempo real para a maioria das operações, com sincronizações completas periódicas
