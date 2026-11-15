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
    id: ComponentID.TelegramSendMessageToChat,
    title: translationKey("Send Message to Telegram"),
    category: translationKey("Telegram"),
    logo: ProviderLogo.Telegram,
    description: translationKey("Send message to Telegram chat"),
    iconProp: IconProp.SendMessage,
    componentType: ComponentType.Component,
    arguments: [
      {
        id: "bot-token",
        name: translationKey("Telegram Bot Token"),
        description: translationKey(
          "Need help creating a bot? Check docs here: https://core.telegram.org/bots#how-do-i-create-a-bot",
        ),
        type: ComponentInputType.Text,
        required: true,
        isSensitive: true,
        placeholder: "1234567890:ABCdefGHIjklMNOpqrsTUVwxyZ",
      },
      {
        id: "chat-id",
        name: translationKey("Chat ID"),
        description: translationKey(
          "The unique identifier for the target chat or username of the target channel (in the format @channelusername). Please make sure the bot is added to the channel as an administrator.",
        ),
        type: ComponentInputType.Text,
        required: true,
        placeholder: "@channelname",
      },
      {
        id: "text",
        name: translationKey("Message Text"),
        description: translationKey("Message to send to Telegram."),
        type: ComponentInputType.LongText,
        required: true,
        placeholder: "Test Telegram message from OneUptime",
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
