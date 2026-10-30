# Update and Security Checks

Once a day, a self-hosted OneUptime asks GitHub whether a newer release is out, and whether a security advisory OneUptime published affects the version you run. When one does, your master admins are asked to upgrade. This page says what the check sends, what you see, and how to turn it off.

:::cards
- [What the check sends](#what-the-check-sends): Two public questions, and nothing about your installation.
- [What you see](#what-you-see): The footer, the Admin Dashboard and one email per advisory.
- [Turn it off](#turn-it-off): For a network without internet access, or to use a mirror.
:::

## What the check sends

The worker sends two requests to GitHub's API (`api.github.com`), without a token:

| Request | What it asks |
| --- | --- |
| `GET /repos/OneUptime/oneuptime/releases/latest` | Which OneUptime release is the latest |
| `GET /repos/OneUptime/oneuptime/security-advisories?state=published` | Which security advisories OneUptime published, the versions each one affects and the release that fixes it |

Nothing about your installation is in them: not the version you run, not its address, and nothing about your users, projects or monitoring data. GitHub sees your server's public IP address, as it does for any request, and a `User-Agent` that names OneUptime. Whether an advisory affects your version is worked out on your server, and no browser calls GitHub.

The check runs when the worker starts and once a day after that. It asks GitHub again at most every 12 hours, and at most once an hour after a request that failed.

## What you see

Only master admins are told. They are the ones who can upgrade, and telling anyone else that the server runs a version with a known security issue would point at an unpatched server.

- A newer release adds **Update available** to the footer of the Dashboard and of the Admin Dashboard. It opens the upgrade guide.
- A published security advisory that affects the version you run adds **Security update** there instead, in red.
- The Admin Dashboard's first page then lists each advisory: its severity, the versions it affects, the release that fixes it, and a link to it on GitHub. It also says when the check last read the advisories, and why the latest check failed, if it did.
- Your master admins and the Admin Notification Email (**Settings** > **Emails** in the Admin Dashboard) get one email about each advisory that affects your version, and never a second one.

All of this goes away as soon as you run a version that no advisory affects. To upgrade, see [Upgrading](/docs/installation/upgrading).

## Turn it off

On a network without internet access, or if your server should not contact GitHub, turn the check off. Nothing is then shown or emailed.

:::tabs
@tab Kubernetes
```yaml
updateCheck:
  disabled: true
```
@tab Docker Compose
```bash
DISABLE_UPDATE_CHECK=true
```
Set it in `config.env`, then run `npm start`.
:::

To check against a mirror inside your network instead, point the check at it. The mirror has to answer with GitHub's shapes.

| Helm value | Docker Compose setting | Default |
| --- | --- | --- |
| `updateCheck.url` | `LATEST_RELEASE_CHECK_URL` | `https://api.github.com/repos/OneUptime/oneuptime/releases/latest` |
| `updateCheck.securityAdvisoriesUrl` | `SECURITY_ADVISORIES_CHECK_URL` | `https://api.github.com/repos/OneUptime/oneuptime/security-advisories` |

## When GitHub cannot be reached

On a network without internet access a failed request is expected, not an error. The worker logs it at debug level, keeps what it read last, and tries again later. The Admin Dashboard says when the advisories were last read, and why the latest check failed: GitHub's rate limit, no route to GitHub, a timeout or an answer that is not GitHub's.

## Next steps

:::cards
- [Upgrading](/docs/installation/upgrading): Upgrade to a newer release, one major version at a time.
- [Architecture](/docs/self-hosted/architecture): Every connection a self-hosted OneUptime makes.
- [Behind a VPN or Firewall](/docs/self-hosted/behind-a-firewall): What reaches your server from outside.
:::
