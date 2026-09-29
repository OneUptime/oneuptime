# Monitor Secrets

You can use secrets to store sensitive information that you want to use in your monitoring checks. Secrets are encrypted and stored securely.

### Adding a secret

To add a secret, please go to OneUptime Dashboard -> Monitors -> Settings -> Secrets -> Create Monitor Secret.

![Create Secret](/docs/static/images/CreateMonitorSecret.png)

You can select which monitors have access to the secret. In this case we added `ApiKey` secret and selected monitors to have access to it.

**Please note**: Secrets are encrypted and stored securely. The secret value is never shown again after it is saved — not in the table, not in the edit form, and not over the API. If you lose the value you will need to get it from wherever it came from and set it again. To rotate a secret, use the **Update Secret Value** button on its row; you do not need to delete and recreate it.

### Using a secret

You can use secrets in the following monitoring types:

- API (in request headers, request body, and URL)
- Website, IP, Port, Ping, SSL Certificate (in URL)
- Synthetic Monitor, Custom Code Monitor (in the code)
- SNMP Monitor (in community string, SNMPv3 auth key, and priv key)

![Using Secret](/docs/static/images/UsingMonitorSecret.png)

To use a secret, add `{{monitorSecrets.SECRET_NAME}}` in the field where you want to use the secret. For example, in this case we added `{{monitorSecrets.ApiKey}}` in the Requets Header field.

Secrets are injected on the probe before Synthetic or Custom Code monitor scripts execute, so references such as `{{monitorSecrets.ApiKey}}` resolve to the decrypted value inside the running script.

### Monitor Secret Permissions

You can select which monitors have access to the secret. You can also update the permissions at any time. So, if you want to add a new monitor to have access to the secret, you can do so by updating the permissions.
