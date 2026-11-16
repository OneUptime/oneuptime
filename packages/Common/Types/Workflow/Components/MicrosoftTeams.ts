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
    id: ComponentID.MicrosoftTeamsSendMessageToChannel,
    title: translationKey("Send Message to Teams"),
    category: translationKey("Microsoft Teams"),
    logo: ProviderLogo.MicrosoftTeams,
    description: translationKey("Send message to teams channel"),
    iconProp: IconProp.SendMessage,
    componentType: ComponentType.Component,
    arguments: [
      {
        id: "webhook-url",
        name: translationKey("Teams Incoming Webhook URL"),
        description: translationKey(
          "Create a channel webhook with Teams Workflows. See: https://support.microsoft.com/en-us/teams/apps-service/create-incoming-webhooks-with-workflows-for-microsoft-teams",
        ),
        type: ComponentInputType.URL,
        required: true,
        isSensitive: true,
        placeholder: "https://...environment.api.powerplatform.com/...",
      },
      {
        id: "text",
        name: translationKey("Message Text"),
        description: translationKey("Message to send to Teams."),
        type: ComponentInputType.LongText,
        required: true,
        placeholder: "Test teams message from OneUptime",
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
