/*
 * Help for the steps that send a message somewhere: Slack, Microsoft Teams,
 * Discord, Telegram and email.
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
