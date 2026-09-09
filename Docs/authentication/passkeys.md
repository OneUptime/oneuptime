# Passkeys

OneUptime supports signing in with a passkey without entering an email address or password. Your device or password manager verifies the sign-in using your fingerprint, face, device PIN, or a compatible security key.

To create a passkey, sign in and open **User Profile → Passkeys & Two Factor Auth → Add Passkey**. Give it a recognizable name, choose **Create Passkey**, and follow your device's prompt. If OneUptime offers recovery codes, save them before continuing.

On the login page, choose **Sign in with a passkey** and select the passkey for your account. The page shows when it is waiting for your device and when it is completing sign-in. Choose **Cancel** while the device prompt is open to try again or use your password. If you are new to passkeys, expand **New to passkeys?** for setup instructions.

Password and SSO sign-in remain available. Passkeys require HTTPS (or localhost during development) and a browser that supports WebAuthn; the login page explains when they are unavailable.

You can rename or remove a passkey from the same profile page and see when it was added. If you dismiss your device's registration prompt, the setup dialog keeps the name you entered so you can retry. An existing security key registered for two factor authentication may still require your password; use **Add Passkey** to create a credential for passwordless sign-in.

Passkey sign-in requires device verification and does not bypass your organization's SSO requirements.

## Screenshots

![Desktop login with the passkey option](screenshots/passkey-login-desktop.png)

![Mobile login with the passkey option](screenshots/passkey-login-mobile.png)

The following screenshots show the actual settings components with sample account data.

![Passkey settings preview](screenshots/passkey-settings-preview.png)

![Add passkey dialog preview](screenshots/passkey-add-modal-preview.png)

![Mobile add passkey dialog preview](screenshots/passkey-add-modal-mobile-preview.png)
