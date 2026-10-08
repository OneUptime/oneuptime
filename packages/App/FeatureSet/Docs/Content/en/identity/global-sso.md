# Global SSO (Instance-wide Single Sign-On)

Global SSO lets a OneUptime **instance administrator** (master admin) configure a single SAML 2.0 or OpenID Connect (OIDC) identity provider **once at the instance level** and connect it to any project on the server. It is the instance-wide counterpart to per-project SSO: instead of every project owner configuring their own identity provider, a master admin sets one up that can serve the whole instance.

Global SSO, including the instance-wide "Require SSO for Login" toggle, is part of every OneUptime edition: every self-hosted instance has it, the Community Edition included, and it needs no license. It is instance administration, so it does not apply to OneUptime Cloud. See [Enterprise Edition](/docs/self-hosted/enterprise) for what each edition includes.

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
   - For SAML: enter a **Name**, the **Sign On URL** and **Issuer** from your identity provider, and paste the **Public Certificate**. Everything else is filled in under **More fields**: the **Signature Method** (`RSA-SHA256`), the **Digest Method** (`SHA256`) and a description (`Sign in with` and the name). Change them only if your IdP needs it. Saving opens the provider's page.
   - For OIDC: enter a **Name**, the **Issuer URL**, and the **Client ID** and **Client Secret** of the app you registered in your IdP. Pasting the IdP's discovery URL into **Issuer URL** works too. Everything else is filled in under **More fields**: the **Discovery URL** (the issuer followed by `/.well-known/openid-configuration`), the **Scopes** (`openid email profile`), the `email` and `name` claim names, and a description (`Sign in with` and the name). Change them only if your IdP needs it. Saving opens the provider's page.

3. **Copy the OneUptime URLs into your identity provider**

   - Open the provider (click its row in the list) to reveal the **Identity Provider URLs** card.
   - For SAML, copy the **ACS URL (Reply URL)** and **Issuer (Entity ID)** into your IdP (Okta, Azure AD, OneLogin, JumpCloud and more).
   - For OIDC, copy the **Redirect URI** into your IdP's allowed redirect list.

4. **Test the provider**
   - Use the **Test this SSO provider** link on the provider's page to run an end-to-end sign-in through your identity provider. The provider must be **enabled** for the link to work. Enabling a global provider only adds a "Sign in with SSO" option on the login page — it never forces SSO or locks anyone out, so it is safe to enable, test, and disable again if needed.

## How Users Sign In

How a global provider behaves depends on whether you attach any projects to it:

- **No projects attached (default-all / invite-first):** Users can sign in with the provider and reach **any project they are already a member of**. New users are **not** created automatically — a user must be invited to a project first. Use this for company-wide SSO where memberships are managed elsewhere.

- **Projects attached (auto-provisioning):** Open the provider and use the **Attached Projects** table to attach one or more projects, each with a set of default teams. Users who sign in are **auto-provisioned** into those projects and added to the default teams on first login. A project you attach starts on its members team; pick other teams if newcomers should start with different access. Add one project + teams at a time to build the list; to change an attachment, delete it and add it again.

If you want to prevent any automatic account creation even when projects are attached, enable **Disable Sign Up with SSO** on the provider — users must then be invited before they can sign in.

## Enforcing SSO

Configuring a global provider does not force anyone to use it; password login still works. To require SSO, use the **Require SSO for Login** controls:

- **Per project:** a project can require SSO, and optionally require a _specific_ provider (project or global). See [Requiring SSO for Your Project](/docs/identity/sso#requiring-sso-for-your-project).
- **Instance-wide:** **Admin** > **Settings** > **Authentication** has a **Require SSO for Login** switch that forces SSO for every user across the instance. It asks you to confirm before it turns on, and saves as soon as you do. Master admins remain exempt so they cannot be locked out.

Turning **Require SSO for Login** on needs an SSO provider that signs people in, so nobody is locked out by it:

- For the whole instance, every project that does not require SSO itself needs one: one of its own SAML or OIDC providers that is on, or a global provider that is on and signs people in to it. While a project has none, turning the switch on is refused, and the message names the projects (or, when there are many, the first few and how many). Turn on a global provider, or a provider in those projects, first. A project that requires a specific provider needs that one: while it is off, deleted, or does not sign people in to the project, the message names the project apart - turn that provider on, or require another one there, first.
- For a project, the same is asked of that project, and of the provider it requires when it requires one.
- For a new project, which has no provider of its own yet: while the instance requires SSO, creating a project needs a global provider that is on and signs people in to every project, or nobody, its creator included, could open it. Without one, creating a project is refused, and the message asks a server admin to turn one on. Master admins can still create projects. A project created with **Require SSO for Login** already on needs the same, whoever creates it.

Turning it off is never refused.

## Turning a provider off or deleting it

Turning a global provider off, deleting it, or restricting it to its attached projects ends the sign-ins it gave where it no longer signs people in. Where SSO is required, people who signed in with it have to sign in with SSO again at their next request, the pages they have open stop receiving live updates at once, and an MCP client someone connected after signing in with it stops working in the project.

Turning the provider on again does not bring those sign-ins back: people sign in with it again. A provider that was already off when you upgraded counts as turned off at the upgrade.

A new certificate or client secret, other URLs or a new name keep everyone signed in.

### Every project that requires SSO keeps a way in

A project that requires SSO, itself or because the whole instance does, always keeps a provider people can sign in to it with. So these changes are refused while they would leave such a project with no provider at all, or take away the provider it requires:

- turning a global provider off, deleting it, or restricting it to its attached projects;
- for a provider restricted to its attached projects: attaching its first project (until then it signs people in to every project), turning an attachment off, moving it to another project or provider, or removing it.

The message names the projects, or the first few and how many there are. Turn on another provider for them first, one of their own or a global one, or turn off **Require SSO for Login** there. A project that requires this very provider is named apart: require another provider there, or turn off **Require SSO for Login**, first. Changes that let a provider sign more people in - turning it or an attachment on, lifting the restriction - are never refused. They reach every app server at once, as turning **Require SSO for Login** off does: people can sign in with the provider straight away.

Two changes to who can sign in are checked one after the other. If another one is being saved at the same moment and takes longer than usual - turning on **Require SSO for Login** for the whole instance reads every project - a change is refused with "Another change to who can sign in with SSO is being saved. Try again in a moment.": save it again. A project created at that moment waits for the change too, and if it waits too long it is refused with "The server's SSO settings are being changed. Create the project again in a moment."

## Related

- [SSO (Project SSO)](/docs/identity/sso)
- [SCIM](/docs/identity/scim)
