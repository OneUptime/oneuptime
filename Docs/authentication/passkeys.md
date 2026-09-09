# Passkeys

OneUptime supports signing in with a passkey without entering an email address or password. Your device or password manager verifies the sign-in using your fingerprint, face, device PIN, or a compatible security key.

To create a passkey, sign in and open **User Profile → Passkeys & Two Factor Auth → Add Passkey**. Give it a recognizable name, choose **Create Passkey**, and follow your device's prompt. If OneUptime offers recovery codes, save them before continuing.

On the login page, choose **Sign in with a passkey** and select the passkey for your account. Password and SSO sign-in remain available. Passkeys require HTTPS (or localhost during development) and a browser that supports WebAuthn.

You can remove a passkey from the same profile page. An existing security key registered for two factor authentication may still require your password; use **Add Passkey** to create a credential for passwordless sign-in.

Passkey sign-in requires device verification and does not bypass your organization's SSO requirements.

## Screenshots

![Desktop login with the passkey option](screenshots/passkey-login-desktop.png)

![Mobile login with the passkey option](screenshots/passkey-login-mobile.png)

