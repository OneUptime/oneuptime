import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";

const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.SlackSendMessageToChannel,
    title: "Send Message to Slack",
    category: "Slack",
    description: "Send message to slack channel",
    iconProp: IconProp.SendMessage,
    componentType: ComponentType.Component,
    arguments: [
      {
        id: "webhook-url",
        name: "Slack Incoming Webhook URL",
        description:
          "Need help creating a webhook? Check docs here: https://api.slack.com/messaging/webhooks",
        type: ComponentInputType.URL,
        required: true,
        isSensitive: true,
        placeholder:
          "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX",
      },
      /*
       * Slack reads its own formatting (mrkdwn), not Markdown, and the message
       * is posted exactly as stored - so this is plain text, as the Teams,
       * Discord and Telegram messages are. It was Markdown, which opened the
       * visual Markdown editor; that editor rewrote Slack's _italic_ as
       * *italic*, which Slack shows in bold, and broke references with
       * underscores in them.
       */
      {
        id: "text",
        name: "Message Text",
        description:
          "Message to send to Slack, sent exactly as typed. Slack formatting works: *bold*, _italic_, <https://example.com|link>.",
        type: ComponentInputType.LongText,
        required: true,
        placeholder: "Test Slack message from OneUptime",
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
        description: "This is executed when the message is successfully posted",
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
