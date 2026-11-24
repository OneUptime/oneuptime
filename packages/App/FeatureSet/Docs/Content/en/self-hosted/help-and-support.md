# Help and Support

Point the help OneUptime offers at your own team: the support address, chat and help page people see, where **Give feedback** goes, what single sign-on says to someone who needs an invitation, and the prompts to get the mobile app. Each one can stay on OneUptime's own, point at an address or link of yours, or be hidden.

:::cards
- [Change where help goes](#change-where-help-goes): One page in the Admin Dashboard.
- [What each setting changes](#what-each-setting-changes): Every place, its default and its choices.
- [Give feedback](#give-feedback): Where what people write is sent.
- [The sign-in message](#the-sign-in-message): Whom to ask for an invitation.
:::

## Change Where Help Goes

:::steps
### Open Help and Support
In the Admin Dashboard, open **Settings**, then **Help and Support** in the side menu.

### Change a place
Select **Change** beside it, pick **Default**, an address or link of your own, or **Hide it**, then select **Save**. **Request Demo** and **Report a Bug or Request a Feature** are switches, saved as soon as you flip them.

### Check what people see
The Help menu and the sign-in screen are previewed beside their settings. People see a change the next time they open a page.
:::

Until you change a place, it shows what OneUptime always has, so a server that never opens the page looks exactly as before.

## What Each Setting Changes

| Setting | Where people see it | Default | Your own |
| --- | --- | --- | --- |
| **Support Email** | Help › **Support Email**, **Contact Support** on the page that is not found, and the address an error screen asks people to send a support bundle to | `support@oneuptime.com` | An email address |
| **Chat** | Help › **Chat on Slack** | OneUptime's community on Slack | A link. A Slack or Microsoft Teams link keeps its name; any other reads **Chat with Support** |
| **Request Demo** | Help › **Request Demo** | Shown | Hidden only |
| **Give Feedback** | Help › **Give feedback**, and **Give feedback** in Search | This server's admins | An email address, or a page of your own |
| **Help and Support** | **Help and Support** in the footer, and **Contact** on the sign-in pages | `https://oneuptime.com/support` | A link |
| **Report a Bug or Request a Feature** | The foot of the products menu, and the public GitHub issue offered after feedback | Shown | Hidden only |
| **Get the Mobile App** | **How to Reach Me**, the on-call setup, a new member's first steps on Home, and **Mobile Apps** in **Project Settings** | The App Store and Google Play | A page of your own, such as your device manager's company portal |
| **Message for People Who Need an Invitation** | The single sign-on screens that say "You need to be invited." and "No project access." | OneUptime's sentence | Your own words |

Every setting but the message can also be hidden. A link starts with `https://`, `http://` or `mailto:`. Any other kind of link, `javascript:` among them, is refused by the page and again by the server.

The Admin Dashboard's own Help menu, footer and products menu keep OneUptime's links: they are for this server's admins, who get help with the server from OneUptime.

### Who Can Read Your Links

The support address and the **Help and Support** link show on the sign-in pages too, so anyone who can open those pages can read them. A chat link and the mobile app's page are sent only to people who are signed in: a chat link is often an invitation into your workspace.

## Give Feedback

| Choice | What happens |
| --- | --- |
| **Default** | As it always has: emailed to the **Admin Notification Email** set in **Settings** › **Emails**, or kept for this server's admins in **Feedback** when there is none. On OneUptime Cloud it goes to the OneUptime team. |
| **An email address** | Emailed there through this server's email settings, with the person's name and email address, so your team can reply. The person gets a copy. |
| **A page of your own** | **Give feedback** opens it in a new tab, such as your help desk's form. Nothing is sent from OneUptime. |
| **Hide Give feedback** | **Give feedback** is not offered anywhere. |

While the server cannot send email, choosing an email address hides **Give feedback** instead of taking a message that cannot reach your team, and the settings page says so. Set up email in **Settings** › **Emails**, and **Give feedback** comes back by itself.

The questions OneUptime asks, such as how easy a guided setup was, are not **Give feedback**: their answers stay in **Feedback**, where **Ask people how things went** turns them off.

## The Sign-In Message

The server's own single sign-on turns away two kinds of people: someone with no account, while the provider creates none ("You need to be invited."), and someone whose account is in no project ("No project access."). Both need an invitation, so both screens show your message, with whom to ask and how to reach them:

```text
Ask the IT service desk to invite you to OneUptime:
it-help@example.com or https://help.example.com/oneuptime
```

- The message is plain text of up to 1000 characters, and cannot contain `<` or `>`.
- Each line is a paragraph, and links and email addresses in it become links.
- The screen's title stays as it is, and the mobile app shows the same words.

## The Mobile App Prompts

With a page of your own, every prompt to get the mobile app points there: one QR code for your page, named by its address, and the steps still name this server's address for the app to connect to. Hidden, there is no prompt at all:

- **Get the mobile app** leaves a new member's first steps on Home, which still finish when the person can be reached and a test page has reached them.
- **How to Reach Me** and the on-call setup offer browsers only.
- **Mobile Apps** leaves **Project Settings**.

## Next Steps

:::cards
- [Global SSO](/docs/identity/global-sso): The server's own single sign-on.
- [Session Length](/docs/self-hosted/session-length): How long people stay signed in.
:::
