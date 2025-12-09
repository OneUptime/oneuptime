import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";

const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.DiscordSendMessageToChannel,
    title: "Send Message to Discord",
    category: "Discord",
    description: "Send message to Discord channel",
    iconProp: IconProp.SendMessage,
    componentType: ComponentType.Component,
    arguments: [
      {
        id: "webhook-url",
        name: "Discord Incoming Webhook URL",
        description:
          "Need help creating a webhook? Check docs here: https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks",
        type: ComponentInputType.URL,
        required: true,
        placeholder:
          "https://discord.com/api/webhooks/1234567890/XXXXXXXXXXXXXXXXXXXXXXXX",
      },
      {
        id: "text",
        name: "Message Text",
        description: "Message to send to Discord.",
        type: ComponentInputType.LongText,
        required: true,
        placeholder: "Test Discord message from OneUptime",
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
