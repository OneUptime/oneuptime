# Your Account

Your account is how OneUptime knows you: the email and password you sign in with, your name, time zone and language, and what protects your sign-in. One account can belong to many projects, and these settings follow you into each of them. How OneUptime reaches you, and when it pages you, is set in each project, under **User Settings**.

```mermaid title="What belongs to your account, and what each project keeps for you"
flowchart TB
    account["Your account:<br/>sign-in and profile"] --> projectA["Project A"]
    account --> projectB["Project B"]
    projectA --> settingsA["User Settings in A:<br/>how you are paged"]
    projectB --> settingsB["User Settings in B:<br/>how you are paged"]
```

:::cards
- [Your profile](#your-profile): Your name, email, time zone, language and picture.
- [Signing in securely](#signing-in-securely): Your password, sign-in links, passkeys and two-factor authentication.
- [Your projects](#your-projects): Switch projects, create one and accept invitations.
- [User Settings](#what-each-project-keeps-for-you): How OneUptime reaches you in each project.
:::

## The user menu

Click your picture at the top right of the dashboard.

| Item | What it does |
| --- | --- |
| **Profile** | Opens **User Profile**: your name, email, time zone, language, picture and sign-in security. |
| **Admin Settings** | Opens the Admin Dashboard. Only master admins of a self-hosted installation see it. |
| **Theme** | Sets the dashboard's theme: **Light**, **Dark** or **System**, which is light or dark as your device is set. |
| **Sign Out** | Signs you out, at once on every OneUptime server. Where your administrator has set it up, it signs you out of your identity provider too. |

**User Profile** has its own side menu. **Basic** holds **Overview** and **Profile Picture**. **Security** and **Danger Zone** are folded: click a section's title to open it.

## Your profile

:::steps
### Open your profile

Click your picture at the top right and choose **Profile**. The **Overview** page opens on the **Basic Info** card: your name, email, time zone and language.

### Edit your details

Click **Edit User** and change what you need:

- **Email**: the address you sign in with. If you change it, you verify the new address again.
- **Full Name**: the name your team sees across OneUptime.
- **Timezone**: the time zone the dashboard shows and reads times in, and the one used for the times in notifications sent to you.
- **Language**: the language of the dashboard on every browser you sign in on, and of your on-call pages. Not set, your pages are in English and the dashboard follows your browser.

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
| **Two-factor authentication** | Ask for a second step after your password or an emailed link: a code from an app, or a security key. |

### Change your password

:::steps
1. Open **Security → Password Management**.
2. Enter the new password in **New Password** and again in **Confirm Password**. It must be at least 15 characters long and not a predictable one, such as a common password or a repeated pattern: a few unrelated words work well. The checklist under the field ticks off each part as you type.
3. Click **Update Password**.
:::

A new password signs every device out of your account, and any password reset link or sign-in link already sent stops working.

Every page that sets a password asks the same: signing up, the reset link from **Forgot password?**, this page, and a server admin's **Set Password**. A password you set before this rule keeps working until you change it.

### Add a passkey

:::steps
1. Open **Security → Passkeys** and click **Add Passkey**.
2. Give it a name you will recognize, such as your device or password manager, and click **Create Passkey**.
3. Follow your browser's prompt to save the passkey.
:::

Next time, choose **More ways to sign in** → **Sign in with a passkey** on the sign-in page.

### Sign in with an emailed link

You can sign in with a link instead of your password. There is nothing to set up.

:::steps
1. On the sign-in page, choose **More ways to sign in** → **Email me a sign-in link**.
2. Enter your email address and click **Email me a sign-in link**. The page then shows **Check your email**.
3. Open the link in the email and click **Sign in**.
:::

The link works once, for 15 minutes, and a newer link replaces it. You can open it on another device, and you are signed in there. If you use two-factor authentication, OneUptime still asks for your second step.

> [!NOTE]
> Master admins of a self-hosted installation can turn sign-in links off with **Let people sign in with an emailed link**, on **Admin Dashboard > Settings > Authentication**. Links already sent then stop working. While the server requires SSO, the sign-in page offers SSO only.

### Turn on two-factor authentication

Two-factor authentication applies when you sign in with your password or an emailed link. It turns on only once your second step works, so it never asks for a step you do not have.

:::steps
### Choose your second step

Open **Security → Two-factor authentication** and click **Enable two-factor authentication**. Choose **Authenticator app** or **Security key**, and click **Continue**.

### Set it up

For an authenticator app, scan the QR code with an app such as 1Password, Google Authenticator or Microsoft Authenticator, enter the 6-digit code it shows, and click **Verify and finish**. For a USB or NFC key, name it and follow your browser's prompt. Two-factor authentication is then on, and the card reads **Enabled**. From your next sign-in with a password or an emailed link, OneUptime asks for your second step.

### Save your backup codes

The first time you add an app, a key or a passkey, OneUptime shows **Your backup codes**. Each code signs you in once if you lose your app or key. Copy or download them, tick the box that says you saved them, and click **Done**.
:::

If you already have an app under **Authenticator apps** or a key under **Security keys**, **Enable two-factor authentication** asks you to confirm instead. While it is on, your last app, key or passkey cannot be removed: add another one first, or turn two-factor authentication off. If the card reads **Setup needed**, two-factor authentication is on with nothing set up yet, often because an administrator required it: click **Finish setup**, or you are asked to set it up at your next sign-in.

### Set up two-factor authentication while signing in

When an administrator requires two-factor authentication and you have nothing set up yet, your next sign-in with a password or an emailed link asks you to set it up before it lets you in. Choose **Authenticator app** or **Security key**, and click **Continue**:

- **Authenticator app**: scan the QR code, enter the 6-digit code your app shows, and click **Verify and Sign In**.
- **Security key**: click **Register Security Key** and follow your browser's prompt. Touch a USB or NFC key, or use your phone's or computer's fingerprint, face or screen lock.

You are then shown your backup codes once, and signed in. **Choose another way** goes back to the choice. A browser that cannot register a security key, such as one on a page without HTTPS, offers only the authenticator app.

> [!TIP]
> Running low on backup codes? **Regenerate codes** on the same page gives you a new set, and the old codes stop working at once.

### When your organization manages your sign-in

On a server that requires single sign-on, you sign in only through your organization's identity provider, such as Okta or Microsoft Entra ID, and OneUptime sets no password, passkey or two-factor authentication for you. **User Profile** then has no **Security** section, and its **Overview** names your provider under **Single Sign-On**. Change your password and your second step with your identity provider. Anything you set up before stays saved: it works again only if the server stops requiring single sign-on, unless a server admin clears it. Master admins keep their own **Security** settings.

The same happens when every project you belong to requires single sign-on and has **Manage Sign-In with SSO** on. Your password still signs you in to OneUptime, but every project asks for SSO, so OneUptime sets no new password, passkey or second step for you:

- **A project that does not**: as soon as you are a member of, or invited to, a project that does not require SSO, or does not have **Manage Sign-In with SSO** on, your **Security** section comes back. **Overview** then names those projects under **Single Sign-On**, as the reason your settings are yours. Leaving that project takes them away again.
- **Projects with different providers**: if all your projects manage sign-in, each with its own identity provider, **Overview** names every provider.
- **Master admins** always keep their own **Security** settings.
- **What you set up before** stays saved, and a server admin can clear it.

## Your projects

You can belong to any number of projects. The project picker at the top left of the dashboard lists them: pick one to switch.

- **Create a project**: open the project picker and click **Create New Project**. On a self-hosted installation, the admin can keep project creation for admins only.
- **Accept an invitation**: when someone invites you, the bell at the top right shows the pending invitation, and opens **Project Invitations**. There you **Accept** or **Reject** it.
- **Leave a project**: ask someone who manages its users to remove you, with **Remove from Project** on its **Users** page.

## What each project keeps for you

**User Settings**, at the right of the bar under the top bar, is yours alone, and each project has its own. Open it in every project you are on call for. It opens on **Setup Checklist** while something is left to set up, and on **Notification Methods** once nothing essential is.

| Page | What it is for | Learn more |
| --- | --- | --- |
| **Setup Checklist** | Walks you through everything below, and shows what is left to do. | |
| **Notification Methods** | The emails, phone numbers, apps and webhooks OneUptime can reach you on. Your sign-in email is added for you. | |
| **How to Reach Me** | Which method to use, and after how long, when an on-call policy pages you. | [Escalation Rules](/docs/on-call/escalation-rules) |
| **Notification Settings** | Which updates you get about incidents, alerts, monitors and more, on which channel. | |
| **Email Preferences** | How many emails you get: one at a time, or rolled up. | [Notification Rollup](/docs/emails/notification-rollup) |
| **On-Call Logs** | Every page sent to you, and what happened to it. | |
| **Incoming Phone Numbers** | The number an incoming call policy rings you on. | [Incoming Call Policy](/docs/on-call/incoming-call-policy) |
| **Calendar Feed** | Your on-call shifts in Google Calendar, Apple Calendar or Outlook. | [Calendar Feeds](/docs/on-call/calendar-feeds) |

## Language and theme

Your theme is saved in your browser, so set it again on another browser or device. Your language is saved in your account once you pick it, and every browser you sign in on starts in it. Logging out keeps them, so on a shared computer the next person starts with yours.

- **Language**: the dashboard starts in your browser's language. To change it, use the language menu at the bottom of any page. Your pick is saved to your account, as **Language** on your profile is, and OneUptime writes your on-call pages in it. See [The language of your pages](/docs/notifications/index#the-language-of-your-pages). These docs have a language menu of their own, at the top.
- **Theme**: choose **Light**, **Dark** or **System** in the user menu. **System** is light or dark as your device is set, and changes with it; every browser starts with it. The sign-in pages use the same theme.

## Deleting your account

Open **Danger Zone → Delete Account**. You can delete your account only once you are in no project: the page lists the projects you are still in. Leave them first, then click **Delete Account** and confirm. Deleting your account is permanent and cannot be undone.

## Troubleshooting

:::details I did not get the email to verify my address
Signing in again sends a new link: check your spam folder too. If you cannot sign in, use **Forgot password?** on the sign-in page. Its reset link verifies your address as well.
:::

:::details I lost my authenticator app
At the second step of signing in, choose **Lost access to your authenticator?** and enter one of your backup codes. Then open **Security → Two-factor authentication** and add your new app. Without backup codes, ask an administrator of your OneUptime installation to reset two-factor authentication on your account.
:::

:::details Signing in asks me to wait before I try another code
After five wrong codes in a row, each next code waits before it is checked: one minute, then two, then four, and so on, up to an hour. OneUptime counts wrong codes for your account wherever they are entered, emails you when the waits begin, and starts counting again when you get a code right. Wait and try again, sign in with a security key, or choose **Lost access to your authenticator?** and enter a backup code. If you did not enter those codes, someone knows your password or can read your email, and the email OneUptime sent you says which. If they can read your email, first change your email account's password and remove any forwarding you did not set up: a new OneUptime password alone does not stop them asking for another sign-in link. Then reset your password with **Forgot password?** on the sign-in page, which ends the wait and any sign-in link already sent.
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
