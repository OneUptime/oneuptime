# Microsoft Teams Integration with OneUptime

## 1. Introduction
*   Briefly explains that the Microsoft Teams integration allows users to:
    *   Receive real-time alerts and notifications from OneUptime directly in Microsoft Teams channels and chats.
    *   Interact with OneUptime (e.g., acknowledge or resolve alerts) from within Microsoft Teams.
    *   Streamline incident management workflows by bringing communication and action into one place.

## 2. Prerequisites
*   An active Azure account with permissions to:
    *   Create and manage App Registrations in Azure Active Directory.
    *   Optionally, create and manage Azure Bot Service resources (if choosing that setup path).
    *   Grant admin consent for API permissions.
*   A OneUptime project.
*   Administrator access to your OneUptime instance to configure environment variables.

## 3. Setup Steps

### Part 1: Azure Active Directory App Registration
*   **Navigate to Azure App Registrations:**
    *   Sign in to the [Azure portal](https://portal.azure.com).
    *   Go to **Azure Active Directory**.
    *   Select **App registrations** from the left menu.
*   **Create a New Registration:**
    *   Click on **+ New registration**.
    *   **Name:** Enter a descriptive name (e.g., "OneUptime Teams Integration").
    *   **Supported account types:** Choose "Accounts in this organizational directory only (Single tenant)" or "Accounts in any organizational directory (Any Azure AD directory - Multitenant)" based on your needs. For most direct integrations, single tenant is appropriate. If you are a SaaS provider using OneUptime to serve multiple customers, multitenant might be considered but requires careful handling.
    *   Leave **Redirect URI** blank for now (we'll configure it shortly).
    *   Click **Register**.
*   **Note Application (client) ID:**
    *   Once registered, copy the **Application (client) ID**. This ID will be used as `MS_TEAMS_APP_CLIENT_ID` in OneUptime and in the bot's manifest file.
*   **Configure Authentication:**
    *   In the app registration menu, go to **Authentication**.
    *   Click **+ Add a platform**.
    *   Select **Web**.
    *   **Redirect URIs:** Add the following URIs. Replace `<your-oneuptime-api-domain>` with your actual OneUptime API domain (e.g., `api.oneuptime.com` or your self-hosted domain).
        *   `https://<your-oneuptime-api-domain>/api/msteams/auth/:projectId/:userId`
        *   `https://<your-oneuptime-api-domain>/api/msteams/auth/:projectId/:userId/user`
        *   *Note: These URIs are handled by the OneUptime backend to process OAuth callbacks.*
    *   Click **Configure**.
*   **Certificates & Secrets:**
    *   Go to **Certificates & secrets**.
    *   Under **Client secrets**, click **+ New client secret**.
    *   Enter a description (e.g., "OneUptime Teams Bot Secret") and choose an expiry period.
    *   Click **Add**.
    *   **Important:** Copy the **Value** of the client secret immediately. This is your `MS_TEAMS_APP_CLIENT_SECRET` for OneUptime. It will not be visible again after you leave this page.
*   **API Permissions:**
    *   Go to **API permissions**.
    *   Click **+ Add a permission**.
    *   Select **Microsoft Graph**.
    *   **Application Permissions** (for bot functionalities):
        *   Select **Application permissions**.
        *   Search for and add the following recommended permissions:
            *   `Team.ReadBasic.All`: Allows the app to read basic properties of all teams, without a signed-in user.
            *   `Channel.ReadBasic.All`: Allows the app to read basic properties of all channels in teams, without a signed-in user.
            *   `Chat.ReadWrite.All`: Allows the app to read and write all chat messages in chats that the app is installed in, without a signed-in user. (Required for the bot to send messages and receive commands in various scopes).
            *   `User.Read.All`: Allows the app to read the full profile of all users, without a signed-in user. (Useful for mapping Teams users to OneUptime users if needed, or for @mentions by the bot).
        *   *Explanation: These permissions allow the OneUptime bot to operate within Teams, such as sending notifications to channels or groups, and accessing necessary information without a user being actively signed in through the bot.*
    *   **Delegated Permissions** (for user-specific actions and sign-in):
        *   Select **Delegated permissions**.
        *   Search for and add the following recommended permissions:
            *   `User.Read`: Allows users to sign in to the app, and allows the app to read the profile of signed-in users. (Standard for user sign-in).
            *   `Chat.ReadWrite`: Allows the app to read and write user's chat messages, on behalf of the signed-in user. (If users will perform actions that require the app to act on their behalf in chats).
            *   `openid`: Standard OpenID Connect scope.
            *   `profile`: Standard OpenID Connect scope for user profile information.
            *   `email`: Standard OpenID Connect scope for user email address.
        *   *Explanation: These permissions allow users to sign in to the OneUptime integration within Teams and authorize OneUptime to perform actions on their behalf, like linking their Teams identity to their OneUptime account.*
    *   **Grant Admin Consent:**
        *   After adding permissions, an administrator must click the **Grant admin consent for [Your Directory]** button for the **Application Permissions**. Delegated permissions are typically consented to by individual users.

### Part 2: Create and Configure the Bot
*   You can create the bot using either the Teams Developer Portal or Azure Bot Service.

*   **Option A: Using Teams Developer Portal (Recommended)**
    *   Navigate to the [Teams Developer Portal](https://dev.teams.microsoft.com/).
    *   Go to **Apps** and click **Import app**.
    *   **Upload Manifest:**
        *   Upload the `manifest.json` file for the OneUptime Teams Bot.
        *   *(A template `manifest.json` can be found at [link to OneUptime's manifest template, e.g., in your GitHub repo or docs site]. Remember to fill in the placeholders, especially `id` with your Azure App Registration's Application (client) ID).*
    *   **Review Configuration:**
        *   Once imported, review the app configuration.
        *   Under **App features > Bot**, ensure the **Bot endpoint address** is correctly set to:
            `https://<your-oneuptime-api-domain>/api/msteams/events`
        *   Ensure the "Bot ID" under the Bot configuration matches your Azure App Registration's Application (client) ID.
    *   **Publish:** Follow the steps in the Developer Portal to test and distribute your app (e.g., publish to your organization).

*   **Option B: Using Azure Bot Service**
    *   In the Azure portal, search for and select **Azure Bot**.
    *   Click **Create**.
    *   **Bot handle:** Choose a unique bot handle.
    *   **Subscription & Resource Group:** Select your Azure subscription and resource group.
    *   **Pricing tier:** Select an appropriate pricing tier (F0 - Free tier is often suitable for development/testing).
    *   **Microsoft App ID:**
        *   Select **Use existing app registration**.
        *   Enter the **Application (client) ID** from the App Registration created in Part 1.
    *   Click **Review + create**, then **Create**.
    *   **Configure Messaging Endpoint:**
        *   Once the bot resource is created, go to its **Configuration** page.
        *   Set the **Messaging endpoint** to:
            `https://<your-oneuptime-api-domain>/api/msteams/events`
    *   **Configure Channels:**
        *   Go to **Channels**.
        *   Add the **Microsoft Teams** channel. Follow the prompts to connect it (usually straightforward if using the same App ID).

### Part 3: Configure OneUptime
*   **Administrator Configuration:**
    *   A OneUptime administrator must set the following environment variables in your OneUptime instance:
        *   `MS_TEAMS_APP_CLIENT_ID`: The Application (client) ID from your Azure App Registration (Part 1).
        *   `MS_TEAMS_APP_CLIENT_SECRET`: The client secret **Value** from your Azure App Registration (Part 1).
    *   Restart your OneUptime instance for the new environment variables to take effect.
*   **Connect in OneUptime Project Settings:**
    *   Log in to your OneUptime dashboard.
    *   Navigate to your Project > **Project Settings**.
    *   Go to **Integrations > Microsoft Teams**.
    *   Click **Connect with Microsoft Teams (Install App)**.
        *   This will redirect you to Microsoft Teams to grant admin consent for the app to be installed into your Teams organization and for the project-level (bot) permissions.
        *   You may need to sign in with a Microsoft account that has administrative privileges in your Teams organization.
    *   **Link Your User Account (if prompted or necessary):**
        *   After the project-level connection is successful, you might be prompted to connect your individual OneUptime user account to your Microsoft Teams user account.
        *   If not automatically redirected, or if you need to connect other users, click **Connect my User Account**.
        *   This will initiate a user consent flow. Sign in with your Microsoft account.

## 4. Using the Integration
*   **Receiving Notifications:**
    *   Once configured, OneUptime can send notifications for alerts, incidents, and other events to specified Microsoft Teams channels.
    *   Configure which notifications are sent to Teams in your Project Settings > **Notification Settings** within OneUptime.
*   **Interacting with Messages:**
    *   Alert notifications sent to Teams may include interactive buttons.
    *   **Acknowledge Alert:** Click this button on an alert card to acknowledge the alert in OneUptime.
    *   **Resolve Alert:** Click this button on an alert card to resolve the alert in OneUptime.
    *   Other interactions might be available depending on the type of notification.

## 5. Troubleshooting
*   **Incorrect Redirect URIs:**
    *   Ensure the Redirect URIs in your Azure App Registration (Authentication > Web) exactly match those specified in Part 1, including `https://` and your correct OneUptime API domain.
*   **Permissions Not Granted:**
    *   Verify that admin consent was granted for all required **Application Permissions** in Azure App Registration > API permissions.
    *   Users might need to individually consent to **Delegated Permissions** if they encounter issues performing actions.
*   **Bot Endpoint Not Reachable:**
    *   Ensure your OneUptime API domain is publicly accessible.
    *   Double-check the messaging endpoint in your Azure Bot settings or Teams Developer Portal is `https://<your-oneuptime-api-domain>/api/msteams/events`.
    *   Check OneUptime server logs for errors when events are sent from Teams.
*   **"Microsoft Teams integration is not configured by your OneUptime administrator" Message:**
    *   This message appears in OneUptime if `MS_TEAMS_APP_CLIENT_ID` is missing from the OneUptime server environment variables. Contact your OneUptime administrator.
*   **Client Secret Issues:**
    *   Ensure the correct client secret **Value** (not the Secret ID) was copied and set as `MS_TEAMS_APP_CLIENT_SECRET` in OneUptime.
    *   If the secret has expired, create a new one in Azure and update the OneUptime configuration.

## 6. Disconnecting the Integration

*   **From OneUptime:**
    *   **Disconnect my User Account:** In Project Settings > Integrations > Microsoft Teams, clicking this will remove the link between your specific OneUptime user and your Microsoft Teams user. The project-level integration (bot) will remain.
    *   **Uninstall App from Teams:** This option will remove the project-level integration, effectively uninstalling the app from your Teams organization and deleting the project's authentication token. This will also disconnect all users associated with this project's Teams integration.
*   **From Azure/Teams:**
    *   **Remove App Registration:** Deleting the App Registration in Azure Active Directory will completely disable the integration.
    *   **Remove Bot Service:** If you created an Azure Bot Service resource, deleting it will stop bot functionalities.
    *   **Uninstall App in Teams:** Microsoft Teams administrators can uninstall or block the app directly from the Teams admin center or from the "Manage your apps" section for users.

---
*This outline provides a comprehensive guide. Specific details or screenshots should be added where appropriate in the final document.*
