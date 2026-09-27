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

## Thread lifecycle

OneUptime records which thread belongs to each incident, alert, or scheduled maintenance event, together with the server connection it was created under. A resource gets one thread per notification rule. When the resource reaches its final state, the thread is archived and locked; if the resource leaves that state again (its final state entry is deleted from the state timeline), OneUptime reopens the same thread.

Each thread creation carries an opaque operation ID in the Discord audit log reason, shown as `oneuptime:<id>`. It contains no resource or user data. If Discord accepts a thread but OneUptime never receives the answer, the record is marked ambiguous and nothing is retried automatically. To recover it, OneUptime looks for that operation ID in the server audit log, which requires the **View Audit Log** permission for the bot. Without that permission, or when no entry matches, a project admin resolves the record by naming the thread or asking for a new one through the reconcile API. Threads created under a previous server connection are not reused until an admin reconciles them.

## Disconnect and troubleshoot

**Unlink Discord account** removes your account link for the project. **Disconnect Discord server** removes the project's connection; it does not revoke a deployment-wide bot token or uninstall the bot from other projects' servers. To connect a different server, disconnect the existing connection first.

If a thread is deleted in Discord, OneUptime stops posting to it and does not create a replacement. Threads archived by hand stay archived. If authorization fails, select **Retry**, then restart the connection. Expired or already-used OAuth links cannot be reused. If no incident channel is available, check the bot's channel and thread permissions before retrying. Removing the bot from a server requires reconnecting it before delivery can resume.

For provider details, see Discord's [OAuth2 documentation](https://docs.discord.com/developers/topics/oauth2) and [thread documentation](https://docs.discord.com/developers/topics/threads).
