import IconProp from "../../Icon/IconProp";
import ProviderLogo from "../../ProviderLogo/ProviderLogo";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";

/*
 * A Mattermost post holds at most 16,383 characters, and Mattermost splits a
 * longer message sent to an incoming webhook into as many posts as it takes.
 * A workflow can place any value in the message - a response body, a log -
 * so the step cuts a longer one to fit one post, ending with a note, rather
 * than fill the channel with posts.
 */
export const MATTERMOST_MAX_MESSAGE_LENGTH: number = 16383;

/*
 * Mattermost's own limit on a name, which the step holds Username to: a name
 * to post under that is longer than any Mattermost user can have is a
 * mistake, such as a reference to the wrong value.
 */
export const MATTERMOST_MAX_NAME_LENGTH: number = 64;

// A webhook's ID: 26 lowercase letters and digits, as Mattermost makes them.
export const MATTERMOST_WEBHOOK_ID_LENGTH: number = 26;

/*
 * The URL of an incoming webhook, as Mattermost shows it: the server's
 * address - with the path Mattermost is served under, if it has one - then
 * /hooks/ and the webhook's ID. The step reads the URL more carefully than
 * this when it runs (Server/Utils/Mattermost/MattermostWebhook); this is the
 * shape the template wizard checks a pasted URL against.
 */
export const MATTERMOST_INCOMING_WEBHOOK_URL_PATTERN: RegExp =
  /^https?:\/\/[^\s/?#@\\]+(?:\/[^\s?#\\]*)?\/hooks\/[a-z0-9]{26}$/;

/*
 * Mattermost takes Slack's incoming webhooks, so this step posts the way the
 * Slack and Discord steps do: to a webhook URL, with the text as it is typed.
 * Mattermost is usually self-hosted, so the URL cannot be pinned to one
 * vendor's host as theirs are; it goes through the same checks as the API
 * steps instead. Posting somewhere else than the webhook's own channel, or as
 * someone else, is under More fields.
 */
const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.MattermostSendMessageToChannel,
    title: "Send Message to Mattermost",
    category: "Mattermost",
    logo: ProviderLogo.Mattermost,
    description: "Send message to Mattermost channel",
    iconProp: IconProp.SendMessage,
    componentType: ComponentType.Component,
    arguments: [
      {
        id: "webhook-url",
        name: "Mattermost Incoming Webhook URL",
        description:
          "Need help creating a webhook? Check docs here: https://docs.mattermost.com/developers/integrate/webhooks/incoming",
        type: ComponentInputType.URL,
        required: true,
        isSensitive: true,
        placeholder:
          "https://mattermost.example.com/hooks/xxxxxxxxxxxxxxxxxxxxxxxxxx",
      },
      /*
       * Mattermost reads Markdown, but the message is posted exactly as
       * stored, so this is plain text, as the Slack, Teams, Discord and
       * Telegram messages are: the visual Markdown editor would rewrite what
       * was typed.
       */
      {
        id: "text",
        name: "Message Text",
        description:
          "Message to send to Mattermost, sent exactly as typed. Mattermost's Markdown works: **bold**, _italic_, [link](https://example.com).",
        type: ComponentInputType.LongText,
        required: true,
        placeholder: "Test Mattermost message from OneUptime",
      },
      {
        id: "channel",
        name: "Channel",
        description:
          "Channel to post in instead of the webhook's own, by its name in the channel's URL, such as town-square. @ and a username sends a direct message.",
        type: ComponentInputType.Text,
        required: false,
        isAdvanced: true,
        placeholder: "town-square",
      },
      {
        id: "username",
        name: "Username",
        description:
          "Name to post under instead of the webhook's. Mattermost uses it only where integrations may override usernames.",
        type: ComponentInputType.Text,
        required: false,
        isAdvanced: true,
        placeholder: "OneUptime",
      },
      {
        id: "icon-url",
        name: "Icon URL",
        description:
          "Picture to post with instead of the webhook's. Mattermost uses it only where integrations may override profile picture icons.",
        type: ComponentInputType.URL,
        required: false,
        isAdvanced: true,
        placeholder: "https://example.com/oneuptime.png",
      },
    ],
    returnValues: [
      {
        id: "error",
        name: "Error",
        description: "Error, if there is any.",
        type: ComponentInputType.Text,
        required: false,
      },
    ],
    inPorts: [
      {
        title: "In",
        description:
          "Please connect components to this port for this component to work.",
        id: "in",
      },
    ],
    outPorts: [
      {
        title: "Success",
        description: "Runs once Mattermost has taken the message.",
        id: "success",
      },
      {
        title: "Error",
        description: "This is executed when there is an error",
        id: "error",
      },
    ],
  },
];

export default components;
