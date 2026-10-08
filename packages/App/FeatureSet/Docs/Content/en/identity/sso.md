# SSO (Single Sign-On)

OneUptime supports SAML 2.0 based Single Sign-On (SSO) for enterprise authentication. SSO allows your team members to log in to OneUptime using your organization's identity provider (IdP), providing centralized access management and enhanced security.

> **Edition:** SSO, including "Require SSO for login", is part of every OneUptime edition: self-hosted installations get it in the Community Edition, with no license needed. On OneUptime Cloud it is available on the **Scale** plan and above. See [Enterprise Edition](/docs/self-hosted/enterprise) for what each edition includes.

## Overview

SSO integration provides the following benefits:

- **Centralized Authentication**: Users log in with their existing corporate credentials
- **Enhanced Security**: Leverage your IdP's multi-factor authentication and security policies
- **Simplified User Management**: Manage access from your existing identity management system
- **Reduced Password Fatigue**: Users don't need to remember a separate OneUptime password

## Setting Up SSO

1. **Navigate to Project Settings**

   - Go to your OneUptime project
   - Navigate to **Project Settings** > **Security** > **SSO**

2. **Create SSO Configuration**

   - Click **Create SSO**
   - Enter a **Name** for the SSO configuration (e.g., "Keycloak SAML" or "Okta SAML")
   - Enter the **Sign On URL** from your identity provider
   - Enter the **Issuer** (Entity ID) from your identity provider
   - Paste the **Public Certificate** from your identity provider
   - On the **Sign-in** step, **Teams** starts on your project's members team: people who sign in for the first time join these teams. Only teams you could invite someone to are accepted: a team that gives more access than you have is named under **Teams**
   - Everything else is filled in under **More fields**: the **Signature Method** (`RSA-SHA256`), the **Digest Method** (`SHA256`) and a description ("Sign in with" and the name). Change them only if your identity provider needs it

3. **Get OneUptime SSO Metadata**
   - Saving opens the **SSO Configuration** dialog. You can open it again with the **View SSO Config** button
   - Copy the **Identifier (Entity ID)** — this is needed in your IdP configuration
   - Copy the **Reply URL (Assertion Consumer Service URL)** — this is needed in your IdP configuration
   - A new provider starts switched off. Once your IdP has these two values, edit the provider and turn **Enabled** on

## Keycloak SAML Configuration

Keycloak is a popular open-source identity and access management solution. Follow these steps to configure Keycloak as your SAML identity provider for OneUptime.

### Prerequisites

- A running Keycloak instance with a configured realm
- Admin access to both Keycloak and OneUptime
- OneUptime account with SSO support

### Step 1: Configure OneUptime SSO

1. Log in to your OneUptime dashboard
2. Navigate to **Project Settings** > **Security** > **SSO**
3. Click **Create SSO** and fill in the following:
   - **Name**: A descriptive name (e.g., `my-project-oneuptime`)
   - **Sign On URL**: `https://<your-keycloak-domain>/auth/realms/<your-realm>/protocol/saml`
   - **Issuer**: `https://<your-keycloak-domain>/auth/realms/<your-realm>`
   - **Certificate**: See [Step 2](#step-2-get-the-keycloak-certificate) below
   - **Signature Method** and **Digest Method**: already set under **More fields** (`RSA-SHA256` and `SHA256`)
4. Save the configuration

### Step 2: Get the Keycloak Certificate

1. In Keycloak, navigate to your client configuration
2. Click **Export** (or go to **Keys** tab depending on your Keycloak version)
3. In the exported JSON file, find the key with `certificate` in the name
4. Copy the certificate value and paste it into OneUptime in the following format:

```
-----BEGIN CERTIFICATE-----
MIICnzCCAYcCBgFyPZ8QFzANBgkqhkiG.......
-----END CERTIFICATE-----
```

### Step 3: Configure Keycloak Client

1. In Keycloak, navigate to **Clients** in your realm
2. Create a new client or edit an existing one
3. Set **Client Protocol** to `saml`
4. Set **Client ID** to the **Identifier (Entity ID)** value from OneUptime's **View SSO Config**
5. Set **Valid Redirect URIs** to your OneUptime URL
6. Set **Root URL** to your OneUptime base URL
7. Paste the **Reply URL (Assertion Consumer Service URL)** from OneUptime into the **Assertion Consumer Service POST Binding URL** field

### Step 4: Configure Keycloak Client Settings

1. Disable **Signing keys config** (under the Keys tab)
2. Set **Name ID Format** to `email`
3. Ensure the **Force Name ID Format** option is enabled so Keycloak always sends the email as the Name ID

### Step 5: Verify the Configuration

1. Save all settings in both Keycloak and OneUptime
2. Try logging in to OneUptime using SSO
3. You should be redirected to your Keycloak login page and back to OneUptime after successful authentication

### Troubleshooting Keycloak

- **Login Fails with Signature Error**: Ensure the certificate is correctly copied, including the `BEGIN CERTIFICATE` and `END CERTIFICATE` lines
- **Name ID Error**: Verify that **Name ID Format** is set to `email` in Keycloak
- **Redirect Loop**: Check that the **Valid Redirect URIs** and **Assertion Consumer Service POST Binding URL** are correctly configured
- **Certificate Not Found**: Make sure you are exporting from the correct client in the correct realm

---

## Microsoft Entra ID (formerly Azure AD / Active Directory) SAML Configuration

Microsoft Entra ID is Microsoft's cloud-based identity and access management service. Follow these steps to configure Entra ID as your SAML identity provider for OneUptime.

### Prerequisites

- Microsoft Entra ID tenant (any tier that supports enterprise applications with SAML SSO)
- Admin access to both Microsoft Entra ID and OneUptime
- OneUptime account with SSO support

### Step 1: Configure OneUptime SSO

1. Log in to your OneUptime dashboard
2. Navigate to **Project Settings** > **Security** > **SSO**
3. Click **Create SSO** and fill in the following:
   - **Name**: A descriptive name (e.g., `Azure AD SAML`)
   - **Sign On URL**: You will get this from Entra ID in [Step 3](#step-3-configure-saml-sso-in-entra-id)
   - **Issuer**: You will get this from Entra ID in [Step 3](#step-3-configure-saml-sso-in-entra-id)
   - **Certificate**: You will get this from Entra ID in [Step 3](#step-3-configure-saml-sso-in-entra-id)
   - **Signature Method** and **Digest Method**: already set under **More fields** (`RSA-SHA256` and `SHA256`)
4. Click **View SSO Config** and copy the **Identifier (Entity ID)** and **Reply URL (Assertion Consumer Service URL)** — you will need these for Entra ID

### Step 2: Create Enterprise Application in Microsoft Entra ID

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com)
2. Navigate to **Identity** > **Applications** > **Enterprise applications**
3. Click **+ New application**
4. Click **+ Create your own application**
5. Enter a name (e.g., "OneUptime")
6. Select **Integrate any other application you don't find in the gallery (Non-gallery)**
7. Click **Create**

### Step 3: Configure SAML SSO in Entra ID

1. In your new enterprise application, go to **Single sign-on**
2. Select **SAML** as the single sign-on method
3. In **Basic SAML Configuration**, click **Edit** and set:
   - **Identifier (Entity ID)**: Paste the **Identifier (Entity ID)** from OneUptime's **View SSO Config**
   - **Reply URL (Assertion Consumer Service URL)**: Paste the **Reply URL** from OneUptime's **View SSO Config**
4. Click **Save**
5. In the **SAML Certificates** section:
   - Download the **Certificate (Base64)**
   - Open the downloaded certificate file in a text editor and copy the contents
6. In the **Set up OneUptime** section, copy:
   - **Login URL** — paste this as the **Sign On URL** in OneUptime
   - **Azure AD Identifier** — paste this as the **Issuer** in OneUptime
7. Go back to OneUptime and paste the certificate and URLs, then save

### Step 4: Configure User Attributes and Claims

1. In the SAML configuration page, click **Edit** on **Attributes & Claims**
2. Ensure the following claims are configured:

| Claim Name                                                           | Value                                   |
| -------------------------------------------------------------------- | --------------------------------------- |
| `Unique User Identifier (Name ID)`                                   | `user.userprincipalname` or `user.mail` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` | `user.mail`                             |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname`    | `user.givenname`                        |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname`      | `user.surname`                          |

3. Set the **Name identifier format** to `Email address`
4. Click **Save**

### Step 5: Assign Users and Groups

1. In your enterprise application, go to **Users and groups**
2. Click **+ Add user/group**
3. Select the users and/or groups you want to grant SSO access
4. Click **Assign**

### Step 6: Verify the Configuration

1. Save all settings in both Entra ID and OneUptime
2. Try logging in to OneUptime using SSO
3. You should be redirected to the Microsoft login page and back to OneUptime after successful authentication

### Troubleshooting Microsoft Entra ID

- **AADSTS700016 Error**: The Identifier (Entity ID) in Entra ID does not match OneUptime — verify both values are identical
- **Certificate Error**: Ensure you downloaded the **Base64** certificate (not the raw/binary format) and included the `BEGIN CERTIFICATE` / `END CERTIFICATE` lines
- **User Not Assigned**: Users must be explicitly assigned to the enterprise application before they can log in via SSO
- **Name ID Mismatch**: Ensure the Name ID claim is set to an email address that matches the user's email in OneUptime

---

## Okta SAML Configuration

Okta is a widely-used identity platform that provides robust SAML SSO capabilities. Follow these steps to configure Okta as your SAML identity provider for OneUptime.

### Prerequisites

- Okta organization with admin access
- OneUptime account with SSO support

### Step 1: Configure OneUptime SSO

1. Log in to your OneUptime dashboard
2. Navigate to **Project Settings** > **Security** > **SSO**
3. Click **Create SSO** and fill in the following:
   - **Name**: A descriptive name (e.g., `Okta SAML`)
   - **Sign On URL**: You will get this from Okta in [Step 3](#step-3-copy-okta-saml-metadata-to-oneuptime)
   - **Issuer**: You will get this from Okta in [Step 3](#step-3-copy-okta-saml-metadata-to-oneuptime)
   - **Certificate**: You will get this from Okta in [Step 3](#step-3-copy-okta-saml-metadata-to-oneuptime)
   - **Signature Method** and **Digest Method**: already set under **More fields** (`RSA-SHA256` and `SHA256`)
4. Click **View SSO Config** and copy the **Identifier (Entity ID)** and **Reply URL (Assertion Consumer Service URL)** — you will need these for Okta

### Step 2: Create SAML Application in Okta

1. Sign in to your Okta Admin Console
2. Navigate to **Applications** > **Applications**
3. Click **Create App Integration**
4. Select **SAML 2.0** and click **Next**
5. Enter "OneUptime" as the **App name** and click **Next**
6. In the **SAML Settings** section, configure:
   - **Single sign-on URL**: Paste the **Reply URL (Assertion Consumer Service URL)** from OneUptime's **View SSO Config**
   - **Audience URI (SP Entity ID)**: Paste the **Identifier (Entity ID)** from OneUptime's **View SSO Config**
   - **Name ID format**: Select `EmailAddress`
   - **Application username**: Select `Email`
7. Click **Next**, then select **I'm an Okta customer adding an internal app** and click **Finish**

### Step 3: Copy Okta SAML Metadata to OneUptime

1. In your Okta application, go to the **Sign On** tab
2. In the **SAML Signing Certificates** section, find the active certificate and click **Actions** > **View IdP metadata**
3. From the metadata XML, or from the **Sign On** tab details:
   - Copy the **Sign On URL** (also called **Identity Provider Single Sign-On URL**) — paste this as the **Sign On URL** in OneUptime
   - Copy the **Issuer** (also called **Identity Provider Issuer**) — paste this as the **Issuer** in OneUptime
4. Download the signing certificate:
   - In the **SAML Signing Certificates** section, click **Actions** > **Download certificate** for the active certificate
   - Open the downloaded `.cert` file in a text editor and copy the contents
   - Paste the certificate into OneUptime (including the `BEGIN CERTIFICATE` and `END CERTIFICATE` lines)
5. Save the OneUptime SSO configuration

### Step 4: Configure Attribute Statements (Optional)

1. In the Okta application, go to the **General** tab
2. Click **Edit** in the **SAML Settings** section and click **Next** to get to the SAML settings
3. In the **Attribute Statements** section, add:

| Name        | Value            |
| ----------- | ---------------- |
| `email`     | `user.email`     |
| `firstName` | `user.firstName` |
| `lastName`  | `user.lastName`  |

4. Click **Next** and then **Finish**

### Step 5: Assign Users and Groups

1. In your Okta application, go to the **Assignments** tab
2. Click **Assign** > **Assign to People** or **Assign to Groups**
3. Select the users or groups you want to grant SSO access
4. Click **Assign** for each selection, then click **Done**

### Step 6: Verify the Configuration

1. Save all settings in both Okta and OneUptime
2. Try logging in to OneUptime using SSO
3. You should be redirected to the Okta login page and back to OneUptime after successful authentication

### Troubleshooting Okta

- **404 or Invalid SSO URL**: Verify the **Single sign-on URL** in Okta matches the **Reply URL** from OneUptime exactly
- **Audience Mismatch**: Ensure the **Audience URI** in Okta matches the **Identifier (Entity ID)** from OneUptime exactly
- **Certificate Error**: Make sure you downloaded the certificate for the **active** signing certificate, not an inactive one
- **User Not Assigned**: Users must be assigned to the Okta application before they can log in via SSO
- **Name ID Error**: Verify that **Name ID format** is set to `EmailAddress` and **Application username** is set to `Email`

---

## Other Identity Providers

OneUptime's SSO implementation uses the SAML 2.0 protocol and should work with any compliant identity provider. The general configuration steps are:

1. In OneUptime, create an SSO configuration and note the **Identifier (Entity ID)** and **Reply URL (Assertion Consumer Service URL)** from the **View SSO Config** button
2. In your identity provider, create a SAML application using:
   - **Assertion Consumer Service URL / Reply URL**: From OneUptime SSO config
   - **Entity ID / Audience URI**: From OneUptime SSO config
   - **Name ID Format**: Email address
3. From your identity provider, copy the following into OneUptime:
   - **Sign On URL** (SSO endpoint)
   - **Issuer** (Entity ID of the IdP)
   - **Public Certificate** (X.509 signing certificate)
4. The **Signature Method** (`RSA-SHA256`) and **Digest Method** (`SHA256`) are already set under **More fields**; change them only if your identity provider signs differently

## OpenID Connect (OIDC)

A project can also sign in through an OpenID Connect provider, such as Google Workspace, Okta, Microsoft Entra ID, Auth0 or Keycloak.

1. Register an app (an OIDC client) with your identity provider and copy its **Issuer URL**, **Client ID** and **Client Secret**.
2. In OneUptime, go to **Project Settings** > **Security** > **OIDC** and click **Create OIDC**.
3. Enter a **Name** (what people see on the sign-in page), the **Issuer URL**, the **Client ID** and the **Client Secret**. You can paste the provider's discovery URL into **Issuer URL** instead.
4. On the **Sign-in** step, **Teams** starts on your project's members team: people who sign in for the first time join these teams. Everything else is filled in under **More fields**: the **Discovery URL** (the issuer followed by `/.well-known/openid-configuration`), the **Scopes** (`openid email profile`), the `email` and `name` claim names, and a description ("Sign in with" and the name). Change them only if your provider needs it. Only teams you could invite someone to are accepted: a team that gives more access than you have is named under **Teams**.
5. Save. The **OIDC Configuration** dialog opens with the **Redirect URI**: add it to your app's allowed redirect URIs. A new provider starts switched off, so then edit it and turn **Enabled** on.
6. Use the link on the **Test OpenID Connect (OIDC)** card to sign in through the provider before you require SSO for the project.

## Requiring SSO for Your Project

Setting up a provider does not stop anyone signing in with a password. To make SSO the only way into the project, use the **Require SSO for Login** switch on **Project Settings** > **Security** > **SSO**, under your providers:

1. Test your provider first, with the link in the **Test Single Sign On (SSO)** card.
2. Turn on **Require SSO for Login**. OneUptime asks before it saves anything: from then on everyone in the project, you included, has to sign in with SSO to open it, and anyone signed in with a password is locked out of the project until they sign in with SSO.
3. Click **Require SSO** to confirm. The switch saves straight away; there is no separate Save button.

Turning **Require SSO for Login** on needs a provider that signs people in to the project: one of its own SAML or OIDC providers that is on, or a global provider that is on and signs people in to it. Without one, OneUptime refuses, and says to turn on a provider for the project and test it first. If you pick a provider the project requires, it has to be one of those, and the same is asked when you require another provider later.

Turning **Require SSO for Login** off saves as soon as you flip it and lets members back in with their password. Project owners, project admins and members with the **Edit Project** permission can change it; anyone else sees the switch locked, with the permission they would need.

On OneUptime Cloud, requiring SSO needs the **Scale** plan, and turning it off works on every plan. Below Scale, **Project Settings** > **Security** > **SSO** shows the plan's upsell; a project a Scale trial left requiring SSO also finds **Require SSO for Login** there, under the upsell, so it can be turned off. Turning it on again needs **Scale**.

## Turning a provider off or deleting it

Turning a SAML or OIDC provider off, or deleting it, ends the sign-ins it gave. In a project that requires SSO, itself or because the whole server does:

- Anyone who signed in with it has to sign in with SSO again at their next request, and the pages they have open stop receiving live updates at once.
- An MCP client someone connected after signing in with it stops working in the project. Connect it again after signing in with SSO.
- Turning the provider on again does not bring those sign-ins back: people sign in with it again.

Changing anything else about a provider keeps everyone signed in: a new certificate or client secret, other URLs, a new name or other teams. Their sign-ins were checked when they were made, and the next sign-in uses the new settings.

While the project requires SSO, OneUptime keeps a way in: you cannot turn off or delete the last provider people can sign in to the project with, counting global providers that sign people in to it, or the provider the project requires. Turn off **Require SSO for Login** first.

When the whole server requires SSO (**Admin** > **Settings** > **Authentication** > **Require SSO for Login**), every project keeps a way in the same way, even one that does not require SSO itself: turn on another provider for it first.

Global providers are held to the same rule: a change to one, or to its attached projects, that would leave a project that requires SSO with no provider is refused, naming the project. See [Global SSO](/docs/identity/global-sso#turning-a-provider-off-or-deleting-it).

Where neither the project nor the server requires SSO, turning a provider off stops new sign-ins with it. People already signed in stay signed in, as people who signed in with a password do.

## Providers left below the Scale plan

A SAML or OIDC provider a project still has keeps signing people in after a Scale trial ends or the plan goes down. So below Scale, the **SSO** and **OIDC** pages list the project's providers under the upsell (**SAML providers still set up**, **OIDC providers still set up**):

- **Turn off** stops a provider at once. OneUptime asks first.
- **Delete** removes it.

Adding a provider, changing one or turning it on again needs **Scale**. The people who can do each are the same as on Scale: turning a provider off needs permission to edit it, deleting it permission to delete it.

While the project still requires SSO, its **SSO** and **OIDC** pages also show **Require SSO for Login**: turn it off before you turn the last provider off. Until then the last provider people can sign in with cannot be turned off or deleted, so nobody is locked out of the project.

A status page's **SSO** and **OIDC** pages list its own providers the same way. While the status page still requires SSO, both pages also show **Require SSO for Login**: turn it off before you turn its providers off, or its private users cannot sign in at all.

## Notes on SSO and Roles

OneUptime does not currently support mapping SAML roles from your identity provider. Role-based access must be configured separately within OneUptime's **Project Settings** > **Security** > **SSO** settings, where you can assign default roles for SSO users.

A provider's teams decide what people who sign in with it can do, so a provider is saved only with teams the person saving it could invite someone to. Every save checks them again: a provider whose teams give more access than you have can only be changed by someone whose access covers them, such as a project owner. Providers saved before this check keep signing people in to their teams. Anyone who may edit a provider can still switch it off, so it can be stopped at once.
