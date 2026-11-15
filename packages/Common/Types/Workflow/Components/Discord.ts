import IconProp from "../../Icon/IconProp";
import ProviderLogo from "../../ProviderLogo/ProviderLogo";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";
import { translationKey } from "../../Translator";

const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.DiscordSendMessageToChannel,
    title: translationKey("Send Message to Discord"),
    category: translationKey("Discord"),
    logo: ProviderLogo.Discord,
    description: translationKey("Send message to Discord channel"),
    iconProp: IconProp.SendMessage,
    componentType: ComponentType.Component,
    arguments: [
      {
        id: "webhook-url",
        name: translationKey("Discord Incoming Webhook URL"),
        description: translationKey(
          "Need help creating a webhook? Check docs here: https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks",
        ),
        type: ComponentInputType.URL,
        required: true,
        isSensitive: true,
        placeholder:
          "https://discord.com/api/webhooks/1234567890/XXXXXXXXXXXXXXXXXXXXXXXX",
      },
      {
        id: "text",
        name: translationKey("Message Text"),
        description: translationKey("Message to send to Discord."),
        type: ComponentInputType.LongText,
        required: true,
        placeholder: "Test Discord message from OneUptime",
      },
    ],
    returnValues: [
      {
        id: "error",
        name: translationKey("Error"),
        description: translationKey("Error, if there is any."),
        type: ComponentInputType.Text,
        required: false,
      },
    ],
    inPorts: [
      {
        title: translationKey("In"),
        description: translationKey(
          "Please connect components to this port for this component to work.",
        ),
        id: "in",
      },
    ],
    outPorts: [
      {
        title: translationKey("Success"),
        description: translationKey(
          "This is executed when the message is successfully posted",
        ),
        id: "success",
      },
      {
        title: translationKey("Error"),
        description: translationKey("This is executed when there is an error"),
        id: "error",
      },
    ],
  },
];

export default components;
