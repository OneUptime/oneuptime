# GitHub Integration

To integrate GitHub with your self-hosted OneUptime instance, you need to create a GitHub App and configure the required environment variables. This allows OneUptime to connect to your GitHub repositories for code repository management.

## Prerequisites

- GitHub Account with organization admin access (for organization repositories) or personal account access
- Access to your OneUptime server configuration

## Setup Instructions

### Step 1: Create a GitHub App

1. Go to GitHub and navigate to your organization or personal settings:

   - **For Organizations:** Go to `https://github.com/organizations/YOUR_ORG/settings/apps`
   - **For Personal Account:** Go to `https://github.com/settings/apps`

2. Click **"New GitHub App"**

3. Fill out the registration form:
   - **GitHub App name:** OneUptime (or any unique name) - **Save this name, you'll need it for the `GITHUB_APP_NAME` environment variable**
   - **Homepage URL:** `https://your-oneuptime-domain.com`
   - **Callback URL:** `https://your-oneuptime-domain.com/api/github/auth/callback`
   - **Setup URL:** `https://your-oneuptime-domain.com/api/github/auth/callback` - **Important: This URL is where GitHub redirects users after they install the app. It must be set for the redirect to work.**
   - **Redirect on update:** Check this option to redirect users after they update the app installation
   - **Request user authorization (OAuth) during installation:** **Check this option — it is required.** See below.
   - **Webhook URL:** `https://your-oneuptime-domain.com/api/github/webhook`
   - **Webhook secret:** Generate a secure random string (save this for later). **Required** — OneUptime rejects unsigned webhooks, so leaving `GITHUB_APP_WEBHOOK_SECRET` unset stops repository sync rather than accepting unverified payloads.

> **Why "Request user authorization (OAuth) during installation" is required**
>
> After an install, GitHub redirects back with an `installation_id` in the URL. That number alone proves nothing about who owns the installation — anyone can type a different one. With this option enabled GitHub also returns a single-use OAuth `code` tied to the GitHub account that performed the install, which OneUptime exchanges to confirm that account really administers the installation before connecting it to your project.
>
> Without it, OneUptime refuses to connect the installation and the dashboard shows an error asking you to enable this setting. This is deliberate: accepting the installation ID unverified would let one OneUptime project claim another organization's repositories.

### Step 2: Configure App Permissions

In the "Permissions & events" section, configure the following permissions:

**Repository Permissions:**

| Permission      | Access Level | Purpose                                                      |
| --------------- | ------------ | ------------------------------------------------------------ |
| Contents        | Read & Write | Read repository files, push branches (required for AI Agent) |
| Pull requests   | Read & Write | Create and manage pull requests                              |
| Issues          | Read & Write | Read and comment on issues                                   |
| Commit statuses | Read         | Check build/CI status                                        |
| Actions         | Read         | Read GitHub Actions workflow runs and logs                   |
| Metadata        | Read         | Basic repository metadata (required)                         |

**Organization Permissions (if using with organizations):**

| Permission | Access Level | Purpose                   |
| ---------- | ------------ | ------------------------- |
| Members    | Read         | List organization members |

**Account Permissions:**

| Permission      | Access Level | Purpose                           |
| --------------- | ------------ | --------------------------------- |
| Email addresses | Read         | Read user email for notifications |

### Step 3: Subscribe to Webhook Events

OneUptime uses the GitHub App's `installation` and `installation_repositories` events to synchronize installation and repository access. GitHub Apps automatically receive these events. The current handler acknowledges other events, including **Pull request**, **Push**, and **Workflow run**, without additional processing; subscribing to them does not enable notifications or CI/CD automation.

### Step 4: Set Installation Access

Under "Where can this GitHub App be installed?", choose:

- **Only on this account** - For private/internal use
- **Any account** - If you want others to install your app

### Step 5: Create the GitHub App

1. Click **"Create GitHub App"**
2. You will be redirected to your app's settings page
3. Note down the following values:
   - **App ID** - Found at the top of the app settings page
   - **Client ID** - Found in the "About" section

### Step 6: Generate Client Secret

1. In your GitHub App settings, scroll to "Client secrets"
2. Click **"Generate a new client secret"**
3. Copy the secret immediately - you won't be able to see it again

### Step 7: Generate Private Key

1. Scroll down to "Private keys" section
2. Click **"Generate a private key"**
3. A `.pem` file will be downloaded automatically
4. Keep this file secure - it's used for authenticating as the GitHub App

### Step 8: Configure OneUptime Environment Variables

#### Docker Compose

If you are using Docker Compose, add these environment variables to your `config.env` file:

```bash
# GitHub App Configuration
GITHUB_APP_ID=YOUR_APP_ID
GITHUB_APP_NAME=YOUR_APP_NAME  # The exact name of your GitHub App (e.g., "OneUptime")
GITHUB_APP_CLIENT_ID=YOUR_CLIENT_ID
GITHUB_APP_CLIENT_SECRET=YOUR_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY="<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
GITHUB_APP_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET
```

**Note:** For the private key encode it as base64 and paste it without new lines if your environment does not support multi-line strings.

#### Kubernetes with Helm

If you are using Kubernetes with Helm, add these to your `values.yaml` file:

```yaml
gitHubApp:
  id: "YOUR_APP_ID"
  name: "YOUR_APP_NAME" # The exact name of your GitHub App
  clientId: "YOUR_CLIENT_ID"
  clientSecret: "YOUR_CLIENT_SECRET"
  privateKey: "<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
  webhookSecret: "YOUR_WEBHOOK_SECRET"
```

**Important:** Restart your OneUptime server after adding these environment variables so they take effect.

### Step 9: Install the GitHub App

1. Go to your GitHub App's public page: `https://github.com/apps/YOUR_APP_NAME`
2. Click **"Install"** or **"Configure"**
3. Select the organization or account where you want to install the app
4. Choose which repositories the app can access:
   - **All repositories** - Access to all current and future repositories
   - **Only select repositories** - Choose specific repositories
5. Click **"Install"**

### Step 10: Connect Repositories in OneUptime

1. Log into your OneUptime dashboard
2. Navigate to **Products** > **Code Repositories**
3. Click **"Create Repository"** or use the GitHub App installation flow
4. If redirected from GitHub, the installation ID will be automatically captured
5. Select the repositories you want to connect from the list
6. Click **"Connect"** to link the repository to your OneUptime project

## Environment Variables Reference

| Variable                    | Description                                                    | Required             |
| --------------------------- | -------------------------------------------------------------- | -------------------- |
| `GITHUB_APP_ID`             | The App ID from your GitHub App settings                       | Yes                  |
| `GITHUB_APP_NAME`           | The exact name of your GitHub App (used for installation URLs) | Yes                  |
| `GITHUB_APP_CLIENT_ID`      | The Client ID from your GitHub App settings                    | Yes                  |
| `GITHUB_APP_CLIENT_SECRET`  | The client secret you generated                                | Yes                  |
| `GITHUB_APP_PRIVATE_KEY`    | The contents of the private key (.pem file)                    | Yes                  |
| `GITHUB_APP_WEBHOOK_SECRET` | The webhook secret for verifying webhook payloads              | Yes, for webhooks    |

## Network access for self-hosted deployments

### Traffic direction and endpoints

| Traffic | Required access |
| --- | --- |
| OneUptime to GitHub | DNS and outbound HTTPS on TCP 443 to `api.github.com` for GitHub App tokens and repository API calls, and `github.com` for OAuth token exchange and HTTPS Git operations |
| GitHub to OneUptime | Public HTTPS on TCP 443 to `POST /api/github/webhook` for installation and repository-access synchronization |
| User's browser to OneUptime | Dashboard access and `GET /api/github/auth/callback` for installation/authorization redirects; these can remain accessible through the user's VPN |

The callback/setup URL is a [browser redirect](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-user-authorization-callback-url), whereas the webhook is a request from GitHub's servers. A user's VPN connection does not give GitHub access to the webhook. The domains above cover the integration's core requests; additional repository tooling, downloads, LFS, or packages may require other destinations. These settings describe GitHub.com; changing the firewall does not configure support for a GitHub Enterprise Server hostname.

### Private deployments and callback security

Expose `/api/github/webhook` through a public gateway with public DNS, a publicly trusted HTTPS certificate and complete chain, and a private route to OneUptime's ingress. Allow inbound TCP 443 to the gateway and restrict public forwarding to this POST route. Keep the dashboard and browser callback on the private ingress if users access them over VPN; split DNS can serve the same hostname internally and externally.

Set `HOST=oneuptime.example.com` and `HTTP_PROTOCOL=https` in `config.env`, or `host: oneuptime.example.com` and `httpProtocol: https` in Helm. Apply the configuration and wait for OneUptime to restart. These values generate URLs; they do not provision DNS, TLS, or network access. If the hostname changes, update the GitHub App's webhook, callback, setup, and homepage URLs.

Preserve the method, original path, query string, body, `Content-Type`, `X-Hub-Signature-256`, `X-GitHub-Event`, and `X-GitHub-Delivery`. Preserve the public host and HTTPS scheme through trusted proxy headers. Exempt the webhook from browser SSO, CAPTCHA, and proxy login pages. Keep GitHub's SSL verification enabled and configure the same `GITHUB_APP_WEBHOOK_SECRET` in both systems: OneUptime rejects unsigned requests and cannot validate webhooks without this secret. See GitHub's [webhook validation guidance](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).

If you also restrict webhook source IPs, use the current `hooks` ranges from GitHub's Meta API and refresh them regularly; do not substitute GitHub Actions runner ranges or omit signature verification. GitHub warns that [its addresses change and the published list is not exhaustive](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-githubs-ip-addresses).

### Verify access and understand limitations

Complete installation from OneUptime, then inspect the GitHub App's **Advanced > Recent Deliveries**. Send or redeliver a test delivery and confirm the gateway forwards it and OneUptime accepts it. Add or remove a test repository from the installation and verify the connected repository list updates. GitHub documents [delivery diagnostics](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/viewing-webhook-deliveries) and requires [a 2xx acknowledgment within ten seconds](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks). A browser GET to the webhook does not test a signed POST.

Without inbound access, browser authorization and outbound API/Git operations may work, but installation deletion and repository-access changes cannot synchronize through webhooks. Current OneUptime webhook handling synchronizes `installation` and `installation_repositories`; accepting other subscribed events does not imply they perform additional automation. The [private network access setting](/docs/self-hosted/private-network-access) controls outbound requests to private destinations and does not make the webhook reachable by GitHub.

## Troubleshooting

### Common Issues

**Not redirected back to OneUptime after installing the GitHub App:**

- Ensure the **Setup URL** is configured in your GitHub App settings to: `https://your-oneuptime-domain.com/api/github/auth/callback`
- Go to your GitHub App settings > "Post installation" section and verify the Setup URL is set correctly
- The "Redirect on update" option should also be checked
- Note: The Setup URL is different from the Callback URL - both should point to the same `/api/github/auth/callback` endpoint

**"GitHub App is not configured" error:**

- Ensure `GITHUB_APP_CLIENT_ID` environment variable is set
- Restart your OneUptime server after setting environment variables

**"Invalid webhook signature" error:**

- Verify your `GITHUB_APP_WEBHOOK_SECRET` matches the secret configured in GitHub
- Ensure the webhook URL is correct and accessible from the internet

**"Failed to get installation access token" error:**

- Verify your `GITHUB_APP_PRIVATE_KEY` is correctly formatted
- Check that the private key includes the BEGIN/END markers
- Ensure the App ID is correct

**Cannot see repositories after installation:**

- Verify the GitHub App has access to the repositories you want to connect
- Check the installation permissions in GitHub (Settings > Applications > Installed GitHub Apps)

**Webhook events not being received:**

- Ensure your webhook URL is publicly accessible
- Check GitHub App webhook delivery logs in your app settings
- Verify the webhook secret is correctly configured

### Checking Webhook Deliveries

1. Go to your GitHub App settings
2. Click on "Advanced" in the sidebar
3. View "Recent Deliveries" to see webhook attempts and responses

## Security Best Practices

1. **Rotate secrets regularly** - Generate new client secrets and private keys periodically
2. **Use webhook secrets** - Always configure a webhook secret to verify payload authenticity
3. **Limit repository access** - Only grant access to repositories that need to be connected
4. **Monitor webhook deliveries** - Regularly check for failed deliveries or suspicious activity
5. **Keep private keys secure** - Never commit private keys to version control

## Support

If you encounter issues with the GitHub integration, please:

1. Check the troubleshooting section above
2. Review the OneUptime logs for detailed error messages
3. Contact us at [hello@oneuptime.com](mailto:hello@oneuptime.com)

We welcome feedback to improve this integration!
