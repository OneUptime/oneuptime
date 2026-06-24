# Global SSO（实例级单点登录）

Global SSO 让 OneUptime **实例管理员**（主管理员，master admin）只需**在实例级别配置一次** SAML 2.0 或 OpenID Connect (OIDC) 身份提供商，即可将其连接到服务器上的任何项目。它是按项目 SSO 的实例级对应方案：无需每个项目所有者各自配置自己的身份提供商，主管理员只需配置一个即可服务整个实例。

Global SSO 是 **OneUptime Enterprise Edition** 功能，仅在运行 Enterprise Edition 构建版本的实例上可用。

## Global SSO 与项目 SSO 对比

|          | 项目 SSO                      | Global SSO                      |
| -------- | ----------------------------- | ------------------------------- |
| 配置者   | 项目所有者/管理员（项目设置） | 实例主管理员（Admin Dashboard） |
| 范围     | 单个项目                      | 整个实例 —— 可连接到任何项目    |
| 登录结果 | 访问该单个项目                | 访问用户可触及的每个项目        |

## 设置 Global SSO

1. **打开 Admin Dashboard**

   - 以主管理员身份登录，并打开 **Admin** > **Settings** > **Global SSO**（针对 SAML）或 **Global OIDC**（针对 OpenID Connect）。

2. **创建提供商**

   - 点击 **Create Global SSO**。
   - 对于 SAML：输入 **Name**、来自身份提供商的 **Sign On URL** 和 **Issuer**，并粘贴 **Public Certificate**。选择 **Signature** 和 **Digest** 方法（如果不确定，请保留默认值 —— `RSA-SHA256` / `SHA256`）。
   - 对于 OIDC：输入 **Discovery URL**、**Issuer**、**Client ID**、**Client Secret**、**Scopes**（必须包含 `openid`），以及 **email** / **name** 声明名称。

3. **将 OneUptime URL 复制到您的身份提供商**

   - 打开该提供商（在列表中点击其所在行）以显示 **Identity Provider URLs** 卡片。
   - 对于 SAML，将 **ACS URL (Reply URL)** 和 **Issuer (Entity ID)** 复制到您的 IdP（Okta、Azure AD、OneLogin、JumpCloud 等）。
   - 对于 OIDC，将 **Redirect URI** 复制到您 IdP 的允许重定向列表中。

4. **测试提供商**
   - 使用该提供商页面上的 **Test this SSO provider** 链接，通过您的身份提供商运行一次端到端的登录。该提供商必须处于**已启用**状态，链接才能正常工作。启用全局提供商只会在登录页面上添加一个"使用 SSO 登录"选项 —— 它绝不会强制使用 SSO 或将任何人锁定在外，因此可以放心地启用、测试，并在需要时再次禁用。

## 用户如何登录

全局提供商的行为取决于您是否为其附加了任何项目：

- **未附加项目（default-all / 邀请优先）：** 用户可以使用该提供商登录，并访问**他们已经是成员的任何项目**。系统**不会**自动创建新用户 —— 用户必须先被邀请加入某个项目。当成员资格在别处管理时，可将此用于全公司范围的 SSO。

- **已附加项目（自动预配）：** 打开该提供商并使用 **Attached Projects** 表附加一个或多个项目，每个项目均带有一组默认团队。登录的用户会被**自动预配**到这些项目中，并在首次登录时被添加到默认团队。一次添加一个项目及其团队来构建列表；若要更改某个附加项，请将其删除后重新添加。

如果您希望即使在已附加项目的情况下也阻止任何自动创建账号，请在该提供商上启用 **Disable Sign Up with SSO** —— 此时用户必须先被邀请才能登录。

## 强制使用 SSO

配置全局提供商并不会强制任何人使用它；密码登录仍然有效。若要要求使用 SSO，请使用 **Require SSO for Login** 控件：

- **按项目：** 项目可以要求使用 SSO，并可选择要求使用*特定*提供商（项目级或全局）。
- **实例级：** **Admin** > **Settings** > **Authentication** 中有一个 **Require SSO for Login** 开关，可强制实例中的每位用户使用 SSO。主管理员仍然豁免，以免被锁定在外。

## 相关内容

- [SSO（项目 SSO）](/docs/identity/sso)
- [SCIM](/docs/identity/scim)
