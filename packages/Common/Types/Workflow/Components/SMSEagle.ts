import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";

const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.SMSEagleSendSms,
    title: "Send SMS via SMSEagle",
    category: "SMSEagle",
    description: "Send SMS via SMSEagle",
    iconProp: IconProp.SMS,
    componentType: ComponentType.Component,
    arguments: [
      {
        id: "api-url",
        name: "SMSEagle URL",
        description:
          "Base URL of your SMSEagle device, for example https://192.168.0.100. The device must be reachable from your OneUptime server.",
        type: ComponentInputType.URL,
        required: true,
        placeholder: "https://192.168.0.100",
      },
      {
        id: "access-token",
        name: "SMSEagle Access Token",
        description:
          "API access token generated in the SMSEagle web GUI (Settings > API > API v2). More information: https://www.smseagle.eu/docs/apiv2/",
        type: ComponentInputType.Text,
        required: true,
        isSensitive: true,
        placeholder: "your-api-v2-access-token",
      },
      {
        id: "to",
        name: "Phone Number",
        description: "Phone number in international format.",
        type: ComponentInputType.Text,
        required: true,
        placeholder: "+15551234567",
      },
      {
        id: "text",
        name: "Message Text",
        description: "Text of the SMS.",
        type: ComponentInputType.LongText,
        required: true,
        placeholder: "Test SMS from OneUptime via SMSEagle",
      },
    ],
    returnValues: [
      {
        id: "message-id",
        name: "Message ID",
        description: "ID of the queued message.",
        type: ComponentInputType.Text,
        required: false,
      },
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
        description: "This is executed when the device queues the SMS",
        id: "success",
      },
      {
        title: "Error",
        description: "This is executed when there is an error",
        id: "error",
      },
    ],
  },
  {
    id: ComponentID.SMSEagleMakeCall,
    title: "Make a Call via SMSEagle",
    category: "SMSEagle",
    description: "Make a text-to-speech call via SMSEagle",
    iconProp: IconProp.Call,
    componentType: ComponentType.Component,
    arguments: [
      {
        id: "api-url",
        name: "SMSEagle URL",
        description:
          "Base URL of your SMSEagle device, for example https://192.168.0.100. The device must be reachable from your OneUptime server.",
        type: ComponentInputType.URL,
        required: true,
        placeholder: "https://192.168.0.100",
      },
      {
        id: "access-token",
        name: "SMSEagle Access Token",
        description:
          "API access token generated in the SMSEagle web GUI (Settings > API > API v2). More information: https://www.smseagle.eu/docs/apiv2/",
        type: ComponentInputType.Text,
        required: true,
        isSensitive: true,
        placeholder: "your-api-v2-access-token",
      },
      {
        id: "to",
        name: "Phone Number",
        description: "Phone number in international format.",
        type: ComponentInputType.Text,
        required: true,
        placeholder: "+15551234567",
      },
      {
        id: "voice-id",
        name: "Voice ID",
        description: "ID of the TTS voice on the SMSEagle device.",
        type: ComponentInputType.Number,
        required: true,
        placeholder: "1",
      },
      {
        id: "text",
        name: "Text to Read Out",
        description: "Text the SMSEagle device reads out during the call.",
        type: ComponentInputType.LongText,
        required: true,
        placeholder: "This is a test call from OneUptime via SMSEagle",
      },
    ],
    returnValues: [
      {
        id: "message-id",
        name: "Message ID",
        description: "ID of the queued call.",
        type: ComponentInputType.Text,
        required: false,
      },
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
        description: "This is executed when the device queues the call",
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
