import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";
import { translationKey } from "../../Translator";

const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.SendEmail,
    title: translationKey("Send Email"),
    category: translationKey("Email"),
    description: translationKey("Send email from your workflows"),
    iconProp: IconProp.Email,
    componentType: ComponentType.Component,
    arguments: [
      {
        type: ComponentInputType.Text,
        name: translationKey("From Email"),
        description: translationKey("Email to send from"),
        placeholder: "Name <email@company.com>",
        required: true,
        id: "from",
      },
      {
        type: ComponentInputType.Text,
        name: translationKey("To Email"),
        description: translationKey("Email to send to"),
        placeholder: "email@company.com; email2@company.com; ...",
        required: true,
        id: "to",
      },
      {
        type: ComponentInputType.Text,
        name: translationKey("Subject"),
        description: translationKey("Subject of the email"),
        required: false,
        id: "subject",
      },
      {
        type: ComponentInputType.HTML,
        name: translationKey("Email Body"),
        description: translationKey("Body of the email"),
        required: false,
        id: "email-body",
      },
      {
        type: ComponentInputType.Text,
        name: translationKey("SMTP HOST"),
        description: translationKey("SMTP Host to send emails from"),
        required: true,
        id: "smtp-host",
      },
      {
        type: ComponentInputType.Text,
        name: translationKey("SMTP Username"),
        description: translationKey("SMTP Username to send emails from"),
        required: false,
        id: "smtp-username",
      },
      {
        type: ComponentInputType.Password,
        name: translationKey("SMTP Password"),
        description: translationKey("SMTP Password to send emails from"),
        required: false,
        id: "smtp-password",
        isSensitive: true,
      },
      {
        type: ComponentInputType.Number,
        name: translationKey("SMTP Port"),
        description: translationKey("SMTP Port to send emails from"),
        required: true,
        id: "smtp-port",
      },
      {
        type: ComponentInputType.Boolean,
        name: translationKey("Use Implicit TLS"),
        description: translationKey(
          "Enable for implicit TLS, usually on port 465. Leave disabled for STARTTLS, usually on port 587.",
        ),
        required: false,
        id: "secure",
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
          "Runs when the mail server accepts the email.",
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
