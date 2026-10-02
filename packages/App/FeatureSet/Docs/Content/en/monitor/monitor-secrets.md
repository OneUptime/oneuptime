# Monitor Secrets

You can use secrets to store sensitive information that you want to use in your monitoring checks. Secrets are encrypted and stored securely.

### Adding a secret

To add a secret, please go to OneUptime Dashboard -> Monitors -> Settings -> Secrets -> Create Monitor Secret.

![Create Secret](/docs/static/images/CreateMonitorSecret.png)

Give the secret a name and a value, then choose which monitors can use it on the **Access** step. In this case we added an `ApiKey` secret.

**Please note**: Secrets are encrypted and stored securely. The secret value is never shown again after it is saved — not in the table, not in the edit form, and not over the API. If you lose the value you will need to get it from wherever it came from and set it again. To rotate a secret, use the **Update Secret Value** button on its row; you do not need to delete and recreate it.

### Choosing which monitors can use a secret

Each secret has one of three access options:

- **All monitors**: every monitor in the project can use the secret, including monitors you create later. Use this for a credential that many monitors share.
- **Specific monitors**: only the monitors you pick can use the secret. This is the default, and secrets created before these options existed work this way.
- **Monitors with labels**: monitors that have at least one of the labels you pick can use the secret. Adding one of those labels to a monitor gives it access, and removing the label takes access away the next time the monitor runs.

You can change the option at any time with **Edit** on the secret's row. Only the list for the chosen option is kept: switching to **All monitors** clears the secret's monitor and label lists, and switching between **Specific monitors** and **Monitors with labels** clears the list you switched away from.

A secret is never available to monitors in another project.

Anyone who can edit a monitor that can use a secret can send that secret anywhere the monitor connects to. With **All monitors**, that is anyone who can create or edit monitors in the project. With **Monitors with labels**, it also includes anyone who can add one of those labels to a monitor.

Over the API, the access option is the `monitorAccess` field: `All Monitors`, `Specific Monitors` or `Monitors With Labels`. The `monitors` and `labels` fields hold the lists. A secret created without `monitorAccess` gets `Specific Monitors`.

### Using a secret

You can use secrets in the following monitoring types:

- API (in request headers, request body, and URL)
- Website, IP, Port, Ping, SSL Certificate (in URL)
- Synthetic Monitor, Custom Code Monitor (in the code)
- SNMP Monitor (in community string, SNMPv3 auth key, and priv key)

![Using Secret](/docs/static/images/UsingMonitorSecret.png)

To use a secret, add `{{monitorSecrets.SECRET_NAME}}` in the field where you want to use the secret. For example, in this case we added `{{monitorSecrets.ApiKey}}` in the Request Header field.

Secrets are injected on the probe before Synthetic or Custom Code monitor scripts execute, so references such as `{{monitorSecrets.ApiKey}}` resolve to the decrypted value inside the running script.

If a monitor references a secret it cannot use, the reference is left as it is and is not replaced with the value.

When you test a monitor before saving it, only secrets available to **All monitors** are filled in, because a new monitor is not on any list and has no labels yet. After you save the monitor, tests use every secret the monitor can use.
