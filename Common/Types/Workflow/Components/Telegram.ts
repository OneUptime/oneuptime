import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";

const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.TelegramSendMessageToChat,
    title: "Send Message to Telegram",
    category: "Telegram",
    description: "Send message to Telegram chat",
    iconProp: IconProp.SendMessage,
    componentType: ComponentType.Component,
    arguments: [
      {
        id: "bot-token",
        name: "Telegram Bot Token",
        description:
          "Need help creating a bot? Check docs here: https://core.telegram.org/bots#how-do-i-create-a-bot",
        type: ComponentInputType.Text,
        required: true,
        placeholder: "1234567890:ABCdefGHIjklMNOpqrsTUVwxyZ",
      },
      {
        id: "chat-id",
        name: "Chat ID",
        description:
          "The unique identifier for the target chat or username of the target channel (in the format @channelusername)",
        type: ComponentInputType.Text,
        required: true,
        placeholder: "@channelname",
      },
      {
        id: "text",
        name: "Message Text",
        description: "Message to send to Telegram.",
        type: ComponentInputType.LongText,
        required: true,
        placeholder: "Test Telegram message from OneUptime",
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
