import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import { IncomingEmailTriggerValue } from "../IncomingEmailTrigger";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";

/*
 * The Incoming Email trigger: a workflow's own email address, and a run for
 * each email sent to it. See Types/Workflow/IncomingEmailTrigger.ts for the
 * address and the values, and Server/Types/Workflow/Components/IncomingEmail.ts
 * for how an email reaches the workflow.
 *
 * Like the Webhook trigger it has no settings: it is opened for its address,
 * which its dialog shows first (ComponentPrimaryPanel).
 */
const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.IncomingEmail,
    title: "Incoming Email",
    category: "Email",
    description:
      "Start this workflow when an email arrives at its own email address.",
    iconProp: IconProp.InboxArrowDown,
    componentType: ComponentType.Trigger,
    arguments: [],
    /*
     * What Run Workflow asks for, to try the workflow without sending an
     * email: the three values most steps read. The rest arrive empty.
     */
    runWorkflowManuallyArguments: [
      {
        id: IncomingEmailTriggerValue.From,
        name: "From",
        description: "The sender to try the workflow with.",
        type: ComponentInputType.Email,
        required: false,
        placeholder: "alerts@example.com",
      },
      {
        id: IncomingEmailTriggerValue.Subject,
        name: "Subject",
        description: "The subject line to try the workflow with.",
        type: ComponentInputType.Text,
        required: false,
        placeholder: "Disk space low on db-1",
      },
      {
        id: IncomingEmailTriggerValue.Body,
        name: "Body",
        description: "The plain text of the email to try the workflow with.",
        type: ComponentInputType.LongText,
        required: false,
      },
    ],
    returnValues: [
      {
        id: IncomingEmailTriggerValue.From,
        name: "From",
        description: "The sender's email address.",
        type: ComponentInputType.Email,
        required: true,
        placeholder: "alerts@example.com",
      },
      {
        id: IncomingEmailTriggerValue.To,
        name: "To",
        description:
          "Who the email was addressed to, as one line: a@example.com, b@example.com.",
        type: ComponentInputType.Text,
        required: false,
      },
      {
        id: IncomingEmailTriggerValue.Cc,
        name: "CC",
        description:
          "Who was copied on the email, written the same way. Empty when nobody was.",
        type: ComponentInputType.Text,
        required: false,
      },
      {
        id: IncomingEmailTriggerValue.Subject,
        name: "Subject",
        description: "The email's subject line.",
        type: ComponentInputType.Text,
        required: false,
      },
      {
        id: IncomingEmailTriggerValue.Body,
        name: "Body",
        description:
          "The email's plain text. Most email has it, even when it was written as HTML.",
        type: ComponentInputType.LongText,
        required: false,
      },
      {
        id: IncomingEmailTriggerValue.HtmlBody,
        name: "HTML Body",
        description:
          "The email's HTML, when it has some. Empty for plain text email.",
        type: ComponentInputType.HTML,
        required: false,
      },
      {
        id: IncomingEmailTriggerValue.Headers,
        name: "Headers",
        description:
          "Every header of the email, by its name in lower case, such as message-id.",
        type: ComponentInputType.StringDictionary,
        required: false,
      },
      {
        id: IncomingEmailTriggerValue.Attachments,
        name: "Attachments",
        description:
          "One entry per attached file, with its filename, contentType and size in bytes. The files themselves are not kept.",
        type: ComponentInputType.JSONArray,
        required: false,
      },
      {
        id: IncomingEmailTriggerValue.ReceivedAt,
        name: "Received At",
        description: "When OneUptime received the email.",
        type: ComponentInputType.DateTime,
        required: true,
      },
    ],
    inPorts: [],
    outPorts: [
      {
        title: "Out",
        description: "Connect the steps to run for each email that arrives.",
        id: "out",
      },
    ],
  },
];

export default components;
