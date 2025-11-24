# Monitor Secrets

You can use secrets to store sensitive information that you want to use in your monitoring checks. Secrets are encrypted and stored securely. 

### Adding a secret

To add a secret, please go to OneUptime Dashboard -> Project Settings -> Monitor Secrets -> Create Monitor Secret.

![Create Secret](/docs/static/images/CreateMonitorSecret.png)

You can select which monitors have access to the secret. In this case we added `ApiKey` secret and selected monitors to have access to it.

**Please note**: Secrets are encrypted and stored securely. If you lose the secret, you will need to create a new secret. You cannot view or update the secret after its saved. 

### Using a secret

You can use secrets in the following monitoring types:

- API (in request headers, request body, and URL)
- Website, IP, Port, Ping, SSL Certificate (in URL)
- Synthetic Monitor, Custom Code Monitor (in the code)


![Using Secret](/docs/static/images/UsingMonitorSecret.png)

To use a secret, add `{{monitorSecrets.SECRET_NAME}}` in the field where you want to use the secret. For example, in this case we added `{{monitorSecrets.ApiKey}}` in the Requets Header field.

Secrets are injected on the probe before Synthetic or Custom Code monitor scripts execute, so references such as `{{monitorSecrets.ApiKey}}` resolve to the decrypted value inside the running script.


### Monitor Secret Permissions

You can select which monitors have access to the secret. You can also update the permissions at any time. So, if you want to add a new monitor to have access to the secret, you can do so by updating the permissions.



