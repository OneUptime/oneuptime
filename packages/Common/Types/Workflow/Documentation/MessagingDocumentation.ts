/*
 * Help for the steps that send a message somewhere: Slack, Microsoft Teams,
 * Discord, Telegram, IRC, Mattermost, SMSEagle and email.
 *
 * Their example is a message with a real value in it, taken from another step
 * of the same workflow - the trigger's, where there is one - so it shows the
 * one thing people most often get stuck on: how to put data into the text.
 */

import ComponentDocumentation, {
  ComponentDocumentationExample,
  ComponentDocumentationNoteType,
  ComponentDocumentationTopic,
} from "./ComponentDocumentation";
import {
  ComponentDocumentationContext,
  SampleValue,
  getSampleValue,
  ownReference,
} from "./DocumentationContext";
import {
  WorkflowDocsPaths,
  docsLink,
  externalLink,
} from "./DocumentationLinks";
import {
  IRC_DEFAULT_NICKNAME,
  IRC_DEFAULT_PLAIN_TEXT_PORT,
  IRC_DEFAULT_TLS_PORT,
  IRC_MAX_LINES,
} from "../Components/IRC";
import { MATTERMOST_MAX_MESSAGE_LENGTH } from "../Components/Mattermost";

export type MessagingDocumentationFunction = (
  context: ComponentDocumentationContext,
) => ComponentDocumentation;

type MessageExampleFunction = (data: {
  context: ComponentDocumentationContext;
  /** What the message says before the value, in the service's own format. */
  prefix: string;
  /** The message when there is no other step to take a value from. */
  plainMessage: string;
}) => ComponentDocumentationExample;

const messageExample: MessageExampleFunction = (data: {
  context: ComponentDocumentationContext;
  prefix: string;
  plainMessage: string;
}): ComponentDocumentationExample => {
  const sample: SampleValue | null = getSampleValue(data.context);

  if (!sample) {
    return {
      title: "A message",
      code: data.plainMessage,
      description: "Values from other steps can go anywhere in the text.",
    };
  }

  return {
    title: "A message with a value from another step",
    code: `${data.prefix}${sample.reference}`,
    description: `The reference puts in ${sample.description}.`,
  };
};

type WhenRefusedTopicFunction = (
  context: ComponentDocumentationContext,
  service: string,
) => ComponentDocumentationTopic;

/*
 * The one value these steps return is the reason a message was refused, and
 * it is only of use on the Error branch - in a Log step, or in a message to
 * somewhere else.
 */
const whenRefusedTopic: WhenRefusedTopicFunction = (
  context: ComponentDocumentationContext,
  service: string,
): ComponentDocumentationTopic => {
  return {
    title: "When it fails",
    paragraphs: [
      `When ${service} refuses the message, the step takes **Error**, and the reason is in the value below: put it in a **Log** step, or in a message somewhere else.`,
    ],
    example: {
      title: `Why ${service} refused it`,
      code: ownReference(context, "error"),
    },
  };
};

export const getSlackDocumentation: MessagingDocumentationFunction = (
  context: ComponentDocumentationContext,
): ComponentDocumentation => {
  return {
    summary: "Posts a message to a Slack channel.",
    steps: [
      "In Slack, create an incoming webhook for the channel ([Slack's guide](https://api.slack.com/messaging/webhooks)) and paste its URL into **Slack Incoming Webhook URL**.",
      "Write the message in **Message Text**.",
      "Connect **Success** to what runs next, and **Error** to what should happen if Slack refuses the message.",
    ],
    examples: [
      messageExample({
        context,
        prefix: "*Heads up:* ",
        plainMessage: "*Heads up:* the nightly export has finished.",
      }),
    ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Warning,
        text: "Only Slack incoming webhook URLs work. They start with `https://hooks.slack.com/services/`.",
      },
    ],
    learnMore: [
      {
        title: "Formatting",
        paragraphs: [
          "The message is sent exactly as you type it, so use Slack's own formatting: `*bold*`, `_italic_`, `~strikethrough~` and `<https://example.com|a link>`.",
        ],
      },
      {
        title: "Keeping the webhook URL private",
        paragraphs: [
          "Anyone with the URL can post to the channel. It is hidden in run logs. To share it between workflows, save it in a secret global variable and use the variable here instead.",
        ],
        example: {
          title: "Slack Incoming Webhook URL",
          code: "{{global.variables.SLACK_WEBHOOK_URL}}",
        },
      },
      whenRefusedTopic(context, "Slack"),
    ],
    links: [
      externalLink(
        "Slack: incoming webhooks",
        "https://api.slack.com/messaging/webhooks",
      ),
      docsLink("Slack step guide", WorkflowDocsPaths.slack),
    ],
  };
};

export const getMicrosoftTeamsDocumentation: MessagingDocumentationFunction = (
  context: ComponentDocumentationContext,
): ComponentDocumentation => {
  return {
    summary: "Posts a message to a Microsoft Teams channel.",
    steps: [
      "In Teams, create a channel webhook with the Workflows app ([Microsoft's guide](https://support.microsoft.com/en-us/teams/apps-service/create-incoming-webhooks-with-workflows-for-microsoft-teams)) and paste its URL into **Teams Incoming Webhook URL**.",
      "Write the message in **Message Text**.",
      "Connect **Success** to what runs next, and **Error** to what should happen if Teams refuses the message.",
    ],
    examples: [
      messageExample({
        context,
        prefix: "**Heads up:** ",
        plainMessage: "**Heads up:** the nightly export has finished.",
      }),
    ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Warning,
        text: "Only Teams webhook URLs work: ones on `environment.api.powerplatform.com`, `logic.azure.com`, `office.com` or `office365.com`.",
      },
    ],
    learnMore: [
      {
        title: "Formatting",
        paragraphs: [
          "The message is shown in a card that wraps long lines. `**bold**`, `_italic_` and `[links](https://example.com)` work in it.",
        ],
      },
      whenRefusedTopic(context, "Teams"),
    ],
    links: [
      externalLink(
        "Microsoft: create a Teams webhook",
        "https://support.microsoft.com/en-us/teams/apps-service/create-incoming-webhooks-with-workflows-for-microsoft-teams",
      ),
      docsLink("Microsoft Teams step guide", WorkflowDocsPaths.microsoftTeams),
    ],
  };
};

export const getDiscordDocumentation: MessagingDocumentationFunction = (
  context: ComponentDocumentationContext,
): ComponentDocumentation => {
  return {
    summary: "Posts a message to a Discord channel.",
    steps: [
      "In Discord, create a webhook in the channel's settings, under Integrations ([Discord's guide](https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks)), and paste its URL into **Discord Incoming Webhook URL**.",
      "Write the message in **Message Text**.",
      "Connect **Success** to what runs next, and **Error** to what should happen if Discord refuses the message.",
    ],
    examples: [
      messageExample({
        context,
        prefix: "**Heads up:** ",
        plainMessage: "**Heads up:** the nightly export has finished.",
      }),
    ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Warning,
        text: "Only Discord webhook URLs work: ones on `discord.com` or `discordapp.com`.",
      },
    ],
    learnMore: [
      {
        title: "Formatting",
        paragraphs: [
          "Discord's own formatting works: `**bold**`, `*italic*`, `~~strikethrough~~` and `[links](https://example.com)`.",
        ],
      },
      whenRefusedTopic(context, "Discord"),
    ],
    links: [
      externalLink(
        "Discord: intro to webhooks",
        "https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks",
      ),
      docsLink("Discord step guide", WorkflowDocsPaths.discord),
    ],
  };
};

export const getTelegramDocumentation: MessagingDocumentationFunction = (
  context: ComponentDocumentationContext,
): ComponentDocumentation => {
  return {
    summary: "Sends a message to a Telegram chat, group or channel.",
    steps: [
      "Create a bot with Telegram's @BotFather ([Telegram's guide](https://core.telegram.org/bots#how-do-i-create-a-bot)) and paste its token into **Telegram Bot Token**.",
      "Add the bot to the group or channel (as an admin in a channel), and put the chat in **Chat ID**: `@channelname` for a public channel, or the chat's number.",
      "Write the message in **Message Text**, then connect **Success** and **Error**.",
    ],
    examples: [
      messageExample({
        context,
        prefix: "Heads up: ",
        plainMessage: "Heads up: the nightly export has finished.",
      }),
    ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Tip,
        text: "A person only gets messages from the bot after they have started a chat with it.",
      },
      {
        type: ComponentDocumentationNoteType.Tip,
        text: "The message is sent as plain text, so formatting marks show exactly as typed.",
      },
    ],
    learnMore: [whenRefusedTopic(context, "Telegram")],
    links: [
      externalLink(
        "Telegram: creating a bot",
        "https://core.telegram.org/bots#how-do-i-create-a-bot",
      ),
      docsLink("Telegram step guide", WorkflowDocsPaths.telegram),
    ],
  };
};

export const getIRCDocumentation: MessagingDocumentationFunction = (
  context: ComponentDocumentationContext,
): ComponentDocumentation => {
  return {
    summary: "Posts a message to an IRC channel.",
    steps: [
      "Enter the server in **IRC Server**, such as `irc.libera.chat`, and the channel in **Channel**, such as `#ops`.",
      "Write the message in **Message Text**. Each line is sent as an IRC message of its own.",
      "Connect **Success** to what runs next, and **Error** to what should happen if the server refuses the message.",
    ],
    examples: [
      messageExample({
        context,
        prefix: "Heads up: ",
        plainMessage: "Heads up: the nightly export has finished.",
      }),
    ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Tip,
        text: `The step connects over TLS on port ${IRC_DEFAULT_TLS_PORT}, joins the channel, sends the message and leaves. A channel with a key needs it in **Channel Key**.`,
      },
      {
        type: ComponentDocumentationNoteType.Tip,
        text: `A message is sent as at most ${IRC_MAX_LINES} IRC lines. A longer one is cut short, and its last line says so.`,
      },
    ],
    learnMore: [
      {
        title: "Signing in",
        paragraphs: [
          "On a network that wants you signed in to an account, such as Libera.Chat from some cloud addresses, fill in **SASL Username** and **SASL Password**. A server or bouncer that asks for a password when you connect takes it in **Server Password**.",
          "Passwords are hidden in run logs. To share one between workflows, save it in a secret global variable and use the variable here instead.",
        ],
        example: {
          title: "SASL Password",
          code: "{{global.variables.IRC_SASL_PASSWORD}}",
        },
      },
      {
        title: "Joining, and the nickname",
        paragraphs: [
          "Most channels only take messages from their members, so the step joins the channel before it posts and leaves straight after. Where a channel takes messages from outside, turn on **Send Without Joining** and the channel does not see the step come and go.",
          `The step posts as \`${IRC_DEFAULT_NICKNAME}\` unless **Nickname** says otherwise. When the nickname is taken, it adds an underscore or a number.`,
        ],
      },
      {
        title: "Formatting",
        paragraphs: [
          "IRC has no Markdown: the message is sent exactly as typed. IRC's own formatting codes, such as bold and colours, work.",
        ],
      },
      {
        title: "Many messages at once",
        paragraphs: [
          "Each run of the step is a connection of its own, and IRC networks limit how often one address may connect. A burst of messages can be refused, with a reason such as `Reconnecting too fast`, and takes **Error**. Where a workflow fires many times a minute, gather what it has to say into one message.",
        ],
      },
      {
        title: "Which servers it can reach",
        paragraphs: [
          "Servers on `localhost`, link-local and cloud metadata addresses are refused. On OneUptime Cloud, servers on a private network are refused too. A self-hosted install can reach a server on its own network, unless `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` is set to `true`.",
          `The server's TLS certificate must be one OneUptime trusts. A self-hosted install can trust its own certificate authority with \`NODE_EXTRA_CA_CERTS\`. Turn on **Disable TLS** only for a server that does not offer TLS: it then connects on port ${IRC_DEFAULT_PLAIN_TEXT_PORT}, and any password is sent unencrypted.`,
        ],
      },
      whenRefusedTopic(context, "the IRC server"),
    ],
    links: [
      externalLink(
        "Libera.Chat: signing in with SASL",
        "https://libera.chat/guides/sasl",
      ),
      docsLink("IRC step guide", WorkflowDocsPaths.irc),
    ],
  };
};

export const getMattermostDocumentation: MessagingDocumentationFunction = (
  context: ComponentDocumentationContext,
): ComponentDocumentation => {
  return {
    summary: "Posts a message to a Mattermost channel.",
    steps: [
      "In Mattermost, add an incoming webhook for the channel ([Mattermost's guide](https://docs.mattermost.com/developers/integrate/webhooks/incoming)) and paste its URL into **Mattermost Incoming Webhook URL**.",
      "Write the message in **Message Text**. Mattermost's Markdown works in it.",
      "Connect **Success** to what runs next, and **Error** to what should happen if Mattermost refuses the message.",
    ],
    examples: [
      messageExample({
        context,
        prefix: "**Heads up:** ",
        plainMessage: "**Heads up:** the nightly export has finished.",
      }),
    ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Warning,
        text: "Only incoming webhook URLs work: the server's address, then `/hooks/` and the webhook's ID, as Mattermost shows it.",
      },
      {
        type: ComponentDocumentationNoteType.Tip,
        text: `A post holds at most ${MATTERMOST_MAX_MESSAGE_LENGTH.toLocaleString("en-US")} characters. A longer message is cut to fit, and ends with a note that the rest is in OneUptime.`,
      },
    ],
    learnMore: [
      {
        title: "Formatting",
        paragraphs: [
          "The message is sent exactly as you type it, and Mattermost reads Markdown: `**bold**`, `_italic_`, `~~strikethrough~~`, `[links](https://example.com)`, tables and emoji such as `:rotating_light:`. `@channel` and `@here` notify everyone in the channel.",
        ],
      },
      {
        title: "Another channel, name or picture",
        paragraphs: [
          "**Channel** posts somewhere other than the webhook's own channel: the channel's name as its URL shows it, such as `town-square`, or `@` and a username for a direct message. A webhook locked to its channel refuses any other.",
          "**Username** and **Icon URL** change who the message seems to come from. Mattermost uses them only where a system admin lets integrations override usernames and profile picture icons; elsewhere it posts as the webhook.",
        ],
      },
      {
        title: "Keeping the webhook URL private",
        paragraphs: [
          "Anyone with the URL can post to the channel. It is hidden in run logs, and the step never quotes it. To share it between workflows, save it in a secret global variable and use the variable here instead.",
        ],
        example: {
          title: "Mattermost Incoming Webhook URL",
          code: "{{global.variables.MATTERMOST_WEBHOOK_URL}}",
        },
      },
      {
        title: "Which servers it can reach",
        paragraphs: [
          "The message is sent from OneUptime, and a redirect is not followed. Servers on `localhost`, link-local and cloud metadata addresses are refused. A server on a private network is refused too, unless a self-hosted administrator allows it with `ALLOW_PRIVATE_NETWORK_WEBHOOKS` or `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST`.",
          "The server's TLS certificate must be one OneUptime trusts. A self-hosted install can trust its own certificate authority with `NODE_EXTRA_CA_CERTS`.",
        ],
      },
      whenRefusedTopic(context, "Mattermost"),
    ],
    links: [
      externalLink(
        "Mattermost: incoming webhooks",
        "https://docs.mattermost.com/developers/integrate/webhooks/incoming",
      ),
      docsLink("Mattermost step guide", WorkflowDocsPaths.mattermost),
      docsLink("Outbound network access", WorkflowDocsPaths.networkAccess),
    ],
  };
};

export const getSMSEagleSendSmsDocumentation: MessagingDocumentationFunction = (
  context: ComponentDocumentationContext,
): ComponentDocumentation => {
  return {
    summary: "Sends an SMS through an SMSEagle device.",
    steps: [
      "Create an API key in the SMSEagle web panel under Settings > API > API v2 ([SMSEagle's guide](https://www.smseagle.eu/docs/apiv2/)) and paste it into **SMSEagle Access Token**.",
      "Put the device's address in **SMSEagle URL**, and the number in international format in **Phone Number**.",
      "Write the message in **Message Text**, then connect **Success** and **Error**.",
    ],
    examples: [
      messageExample({
        context,
        prefix: "Heads up: ",
        plainMessage: "Heads up: the nightly export has finished.",
      }),
    ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Tip,
        text: "The API key needs the Send SMS permission.",
      },
      {
        type: ComponentDocumentationNoteType.Tip,
        text: "An SMSEagle device usually has a private address. A self-hosted instance has to allow that address before the step can reach it.",
      },
    ],
    learnMore: [whenRefusedTopic(context, "SMSEagle")],
    links: [
      externalLink("SMSEagle APIv2", "https://www.smseagle.eu/docs/apiv2/"),
      docsLink("SMSEagle step guide", WorkflowDocsPaths.smsEagle),
    ],
  };
};

export const getSMSEagleMakeCallDocumentation: MessagingDocumentationFunction =
  (context: ComponentDocumentationContext): ComponentDocumentation => {
    return {
      summary:
        "Calls a phone through an SMSEagle device and reads the text out.",
      steps: [
        "Create an API key in the SMSEagle web panel under Settings > API > API v2 ([SMSEagle's guide](https://www.smseagle.eu/docs/apiv2/)) and paste it into **SMSEagle Access Token**.",
        "Put the device's address in **SMSEagle URL**, the number in international format in **Phone Number**, and the ID of a text-to-speech voice on the device in **Voice ID**.",
        "Write the text in **Text to Read Out**, then connect **Success** and **Error**.",
      ],
      examples: [
        messageExample({
          context,
          prefix: "Heads up: ",
          plainMessage: "Heads up: the nightly export has finished.",
        }),
      ],
      notes: [
        {
          type: ComponentDocumentationNoteType.Tip,
          text: "The API key needs the Make a TTS Advanced Call permission.",
        },
        {
          type: ComponentDocumentationNoteType.Tip,
          text: "An SMSEagle device usually has a private address. A self-hosted instance has to allow that address before the step can reach it.",
        },
      ],
      learnMore: [whenRefusedTopic(context, "SMSEagle")],
      links: [
        externalLink("SMSEagle: APIv2", "https://www.smseagle.eu/docs/apiv2/"),
        docsLink("SMSEagle step guide", WorkflowDocsPaths.smsEagle),
      ],
    };
  };

export const getSendEmailDocumentation: MessagingDocumentationFunction = (
  context: ComponentDocumentationContext,
): ComponentDocumentation => {
  const sample: SampleValue | null = getSampleValue(context);

  return {
    summary: "Sends an email through a mail server you choose.",
    steps: [
      "Fill in **From Email**, **To Email**, **Subject** and the **Email Body**, which is HTML.",
      "Enter the mail server in **SMTP HOST** and **SMTP Port**, and its **SMTP Username** and **SMTP Password** if it needs them.",
      "Turn **Use Implicit TLS** on for port 465. Leave it off for port 587.",
      "Connect **Success** to what runs next, and **Error** to what should happen if the email cannot be sent.",
    ],
    examples: [
      sample
        ? {
            title: "An email body with a value from another step",
            code: `<p>Heads up: <strong>${sample.reference}</strong></p>`,
            description: `The reference puts in ${sample.description}.`,
          }
        : {
            title: "An email body",
            code: "<p>Heads up: the nightly export has <strong>finished</strong>.</p>",
          },
    ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Tip,
        text: "This step sends through the server you enter here, not through your project's email settings, and its emails are not in Notification Logs.",
      },
      {
        type: ComponentDocumentationNoteType.Tip,
        text: "To send to several people, separate the addresses in **To Email** with commas or semicolons.",
      },
    ],
    learnMore: [
      {
        title: "Which mail servers it can reach",
        paragraphs: [
          "Servers on `localhost`, link-local and cloud metadata addresses are refused. On OneUptime Cloud, servers on a private network are refused too. A self-hosted install can reach a server on its own network, unless `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` is set to `true`.",
        ],
      },
      {
        title: "Checking what was sent",
        paragraphs: [
          "The run's log says whether the mail server accepted the email. When it did not, the step takes **Error**, and the server's reason is in the value below.",
        ],
        example: {
          title: "Why the email was not sent",
          code: ownReference(context, "error"),
        },
      },
    ],
    links: [docsLink("Send Email guide", WorkflowDocsPaths.email)],
  };
};
