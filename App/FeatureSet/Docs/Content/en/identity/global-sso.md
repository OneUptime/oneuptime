# Global SSO (Instance-wide Single Sign-On)

Global SSO lets a OneUptime **instance administrator** (master admin) configure a single SAML 2.0 or OpenID Connect (OIDC) identity provider **once at the instance level** and connect it to any project on the server. It is the instance-wide counterpart to per-project SSO: instead of every project owner configuring their own identity provider, a master admin sets one up that can serve the whole instance.

Global SSO is a **OneUptime Enterprise Edition** feature and is only available on instances running the Enterprise Edition build.

## Global SSO vs. Project SSO

|                | Project SSO                            | Global SSO                                      |
| -------------- | -------------------------------------- | ----------------------------------------------- |
| Configured by  | Project owner/admin (Project Settings) | Instance master admin (Admin Dashboard)         |
| Scope          | A single project                       | The whole instance — connectable to any project |
| Sign-in result | Access to that one project             | Access to every project the user can reach      |

## Setting Up Global SSO

1. **Open the Admin Dashboard**

   - Sign in as a master admin and open **Admin** > **Settings** > **Global SSO** (for SAML) or **Global OIDC** (for OpenID Connect).

2. **Create a provider**

   - Click **Create Global SSO**.
   - For SAML: enter a **Name**, the **Sign On URL** and **Issuer** from your identity provider, and paste the **Public Certificate**. Choose the **Signature** and **Digest** methods (leave the defaults — `RSA-SHA256` / `SHA256` — if you are unsure).
   - For OIDC: enter the **Discovery URL**, **Issuer**, **Client ID**, **Client Secret**, **Scopes** (must include `openid`), and the **email** / **name** claim names.

3. **Copy the OneUptime URLs into your identity provider**

   - Open the provider (click its row in the list) to reveal the **Identity Provider URLs** card.
   - For SAML, copy the **ACS URL (Reply URL)** and **Issuer (Entity ID)** into your IdP (Okta, Azure AD, OneLogin, JumpCloud and more).
   - For OIDC, copy the **Redirect URI** into your IdP's allowed redirect list.

4. **Test the provider**
   - Use the **Test this SSO provider** link on the provider's page to run an end-to-end sign-in through your identity provider. The provider must be **enabled** for the link to work. Enabling a global provider only adds a "Sign in with SSO" option on the login page — it never forces SSO or locks anyone out, so it is safe to enable, test, and disable again if needed.

## How Users Sign In

How a global provider behaves depends on whether you attach any projects to it:

- **No projects attached (default-all / invite-first):** Users can sign in with the provider and reach **any project they are already a member of**. New users are **not** created automatically — a user must be invited to a project first. Use this for company-wide SSO where memberships are managed elsewhere.

- **Projects attached (auto-provisioning):** Open the provider and use the **Attached Projects** table to attach one or more projects, each with a set of default teams. Users who sign in are **auto-provisioned** into those projects and added to the default teams on first login. Add one project + teams at a time to build the list; to change an attachment, delete it and add it again.

If you want to prevent any automatic account creation even when projects are attached, enable **Disable Sign Up with SSO** on the provider — users must then be invited before they can sign in.

## Enforcing SSO

Configuring a global provider does not force anyone to use it; password login still works. To require SSO, use the **Require SSO for Login** controls:

- **Per project:** a project can require SSO, and optionally require a _specific_ provider (project or global).
- **Instance-wide:** **Admin** > **Settings** > **Authentication** has a **Require SSO for Login** toggle that forces SSO for every user across the instance. Master admins remain exempt so they cannot be locked out.

## Related

- [SSO (Project SSO)](/docs/identity/sso)
- [SCIM](/docs/identity/scim)
