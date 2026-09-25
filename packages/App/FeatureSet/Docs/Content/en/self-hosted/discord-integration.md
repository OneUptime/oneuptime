# Discord integration

Connect a Discord server to your OneUptime project and link each responder's Discord account. Choose a text channel for incident threads so discussions stay together without creating a channel for every incident.

## Configure the application

1. Create an application in the [Discord developer portal](https://discord.com/developers/applications). Record its application ID and public key. Create a bot for the application.
2. Configure these server environment variables, then restart OneUptime:

   - `DISCORD_APP_CLIENT_ID`: the application ID.
   - `DISCORD_APP_CLIENT_SECRET`: the OAuth client secret.
   - `DISCORD_BOT_TOKEN`: the bot token.
   - `DISCORD_APP_PUBLIC_KEY`: the application's interaction verification public key.

   Keep the client secret and bot token in your deployment's secret store. Do not place them in browser configuration or share them with project members. Docker Compose reads these variables from the deployment environment. For Helm, use `discordApp.existingSecret` with `name`, `clientIdKey`, `clientSecretKey`, `botTokenKey`, and `publicKeyKey`; direct values are also available under `discordApp`.

3. Open **Project settings > Discord**. Register the displayed install and account callback URLs under the application's OAuth2 redirects. Their paths are `/api/discord/oauth/install` and `/api/discord/oauth/user`.
4. Set the application's interaction endpoint to the displayed `/api/discord/interactions` URL. Use a publicly reachable HTTPS address that Discord can call. The browser must also reach the same OneUptime hostname to complete its cookie-bound OAuth flow.

The setup page displays public application configuration only. If setup is incomplete, connection buttons stay disabled.

## Connect the server and accounts

1. In **Project settings > Discord**, select **Connect Discord server**. Choose a server you can manage and complete Discord's authorization flow.
2. Select the **Incident parent channel** and choose **Save incident channel**. Only eligible text channels appear. Give the bot permission to view the channel, send messages, read message history, create public and private threads, send messages in threads, and manage threads. Check channel-specific permission overrides as well as server roles.
3. Each responder opens **User settings > Discord** and selects **Link Discord account**. Link the account that belongs to the connected Discord server. Account links apply to the selected OneUptime project.

The selected server and incident parent persist when you reload the page. Incident threads preserve the parent channel and message history when archived and locked.

## Disconnect and troubleshoot

**Unlink Discord account** removes your account link for the project. **Disconnect Discord server** removes the project's connection; it does not revoke a deployment-wide bot token or uninstall the bot from other projects' servers. To connect a different server, disconnect the existing connection first.

If authorization fails, select **Retry**, then restart the connection. Expired or already-used OAuth links cannot be reused. If no incident channel is available, check the bot's channel and thread permissions before retrying. Removing the bot from a server requires reconnecting it before delivery can resume.

For provider details, see Discord's [OAuth2 documentation](https://docs.discord.com/developers/topics/oauth2) and [thread documentation](https://docs.discord.com/developers/topics/threads).
