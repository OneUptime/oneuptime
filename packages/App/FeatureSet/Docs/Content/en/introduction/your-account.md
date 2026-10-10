# Your Account

Your account is how OneUptime knows you: the email and password you sign in with, your name and time zone, and what protects your sign-in. One account can belong to many projects, and these settings follow you into each of them. How OneUptime reaches you, and when it pages you, is set in each project, under **User Settings**.

```mermaid title="What belongs to your account, and what each project keeps for you"
flowchart TB
    account["Your account:<br/>sign-in and profile"] --> projectA["Project A"]
    account --> projectB["Project B"]
    projectA --> settingsA["User Settings in A:<br/>how you are paged"]
    projectB --> settingsB["User Settings in B:<br/>how you are paged"]
```

:::cards
- [Your profile](#your-profile): Your name, email, time zone and picture.
- [Signing in securely](#signing-in-securely): Your password, passkeys and two-factor authentication.
- [Your projects](#your-projects): Switch projects, create one and accept invitations.
- [User Settings](#what-each-project-keeps-for-you): How OneUptime reaches you in each project.
:::

## The user menu

Click your picture at the top right of the dashboard.

| Item | What it does |
| --- | --- |
| **Profile** | Opens **User Profile**: your name, email, time zone, picture and sign-in security. |
| **Admin Settings** | Opens the Admin Dashboard. Only master admins of a self-hosted installation see it. |
| **Dark theme** | Switches the dashboard to its dark theme. In the dark theme, the item reads **Light theme**. |
| **Log out** | Signs you out. |

**User Profile** has its own side menu. **Basic** holds **Overview** and **Profile Picture**. **Security** and **Danger Zone** are folded: click a section's title to open it.

## Your profile

:::steps
### Open your profile

Click your picture at the top right and choose **Profile**. The **Overview** page opens on the **Basic Info** card: your name, email and time zone.

### Edit your details

Click **Edit User** and change what you need:

- **Email**: the address you sign in with. If you change it, you verify the new address again.
- **Full Name**: the name your team sees across OneUptime.
- **Timezone**: the time zone the dashboard shows and reads times in, and the one used for the times in notifications sent to you.

Click **Save Changes**.

### Add a picture

Choose **Profile Picture**, click **Update Profile Picture** and upload an image. It shows on your user menu, and next to your name in lists of people.
:::

> [!NOTE]
> The first time you sign in on a browser, OneUptime saves that browser's time zone to your profile. If you later sign in where the browser's time zone is different, the dashboard asks whether to **Update Timezone**. Close it, and it does not ask again for that time zone.

## Signing in securely

Expand **Security** in the side menu of **User Profile**. It has three pages.

| Page | What it is for |
| --- | --- |
| **Password Management** | Set a new password. |
| **Passkeys** | Sign in without a password, with your fingerprint, face, screen lock or a security key. |
| **Two-factor authentication** | Ask for a second step after your password: a code from an app, or a security key. |

### Change your password

:::steps
1. Open **Security → Password Management**.
2. Enter the new password in **Password** and again in **Confirm Password**. It must be at least 6 characters long.
3. Click **Update Password**.
:::

### Add a passkey

:::steps
1. Open **Security → Passkeys** and click **Add Passkey**.
2. Give it a name you will recognize, such as your device or password manager, and click **Create Passkey**.
3. Follow your browser's prompt to save the passkey.
:::

Next time, choose **Sign in with a passkey** on the sign-in page.

### Turn on two-factor authentication

Two-factor authentication applies when you sign in with your password. Add a second step first, then turn it on.

:::steps
### Add an authenticator app

Open **Security → Two-factor authentication**. Under **Authenticator apps**, add an app and give it a name. Scan the QR code with an app such as 1Password, Google Authenticator or Microsoft Authenticator, enter the 6-digit code it shows, and click **Verify and finish**. To use a USB or NFC key instead, add it under **Security keys**.

### Save your backup codes

The first time you add an app, a key or a passkey, OneUptime shows **Your backup codes**. Each code signs you in once if you lose your app or key. Copy or download them, tick the box that says you saved them, and click **Done**.

### Turn it on

At the top of the page, click **Enable two-factor authentication** and confirm. The card now reads **Enabled**. From your next sign-in with a password, OneUptime asks for your second step.
:::

> [!TIP]
> Running low on backup codes? **Regenerate codes** on the same page gives you a new set, and the old codes stop working at once.

## Your projects

You can belong to any number of projects. The project picker at the top left of the dashboard lists them: pick one to switch.

- **Create a project**: open the project picker and click **Create New Project**. On a self-hosted installation, the admin can keep project creation for admins only.
- **Accept an invitation**: when someone invites you, the bell at the top right shows the pending invitation, and opens **Project Invitations**. There you **Accept** or **Reject** it.
- **Leave a project**: ask someone who manages its users to remove you, with **Remove from Project** on its **Users** page.

## What each project keeps for you

**User Settings**, at the right of the bar under the top bar, is yours alone, and each project has its own. Open it in every project you are on call for.

| Page | What it is for | Learn more |
| --- | --- | --- |
| **Setup Checklist** | Walks you through everything below, and shows what is left to do. | |
| **Notification Methods** | The emails, phone numbers, apps and webhooks OneUptime can reach you on. Your sign-in email is added for you. | |
| **On-Call Rules** | Which method to use, and after how long, when an on-call policy pages you. | [Escalation Rules](/docs/on-call/escalation-rules) |
| **Notification Settings** | Which updates you get about incidents, alerts, monitors and more, on which channel. | |
| **Email Preferences** | How many emails you get: one at a time, or rolled up. | [Notification Rollup](/docs/emails/notification-rollup) |
| **On-Call Logs** | Every page sent to you, and what happened to it. | |
| **Incoming Phone Numbers** | The number an incoming call policy rings you on. | [Incoming Call Policy](/docs/on-call/incoming-call-policy) |
| **Calendar Feed** | Your on-call shifts in Google Calendar, Apple Calendar or Outlook. | [Calendar Feeds](/docs/on-call/calendar-feeds) |

## Language and theme

Both are saved in your browser, not in your account, so set them again on another browser or device.

- **Language**: the dashboard starts in your browser's language. To change it, use the language menu at the bottom of any page. These docs have a language menu of their own, at the top.
- **Theme**: choose **Dark theme** in the user menu. The dashboard starts in the light theme.

## Deleting your account

Open **Danger Zone → Delete Account**. You can delete your account only once you are in no project: the page lists the projects you are still in. Leave them first, then click **Delete Account** and confirm. Deleting your account is permanent and cannot be undone.

## Troubleshooting

:::details I did not get the email to verify my address
Signing in again sends a new link: check your spam folder too. If you cannot sign in, use **Forgot password?** on the sign-in page. Its reset link verifies your address as well.
:::

:::details I lost my authenticator app
At the second step of signing in, choose **Lost access to your authenticator?** and enter one of your backup codes. Then open **Security → Two-factor authentication** and add your new app. Without backup codes, ask an administrator of your OneUptime installation to reset two-factor authentication on your account.
:::

:::details Times in the dashboard are an hour off
The dashboard shows times in the **Timezone** on your profile, not your computer's. Check it on **User Profile → Overview**.
:::

## Next steps

:::cards
- [Home Page & Shortcuts](/docs/introduction/home): Find your way around the dashboard.
- [Escalation Rules](/docs/on-call/escalation-rules): How an on-call policy pages you.
- [Users, Teams & Permissions](/docs/permissions/index): What decides what you can do in a project.
- [SSO](/docs/identity/sso): Sign in through your company's identity provider.
:::
