import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import {
  HuntressTriggerEvent,
  HuntressTriggerSetting,
  HuntressTriggerValue,
} from "../HuntressTrigger";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";
import { translationKey } from "../../Translator";

/*
 * The Huntress Incident Report trigger: a run for each event Huntress sends
 * about an incident report. See Types/Workflow/HuntressTrigger.ts for its
 * address and values, Server/Utils/Huntress/HuntressWebhookHandler.ts for
 * how a request is checked, and Server/Types/Workflow/Components/Huntress.ts
 * for the run.
 *
 * Like the Webhook trigger, it is opened for its URL - with the signing
 * secret and what Huntress last sent beside it (ComponentPrimaryPanel). Its
 * settings are all optional and folded away: which organizations' reports
 * start it, and the incident severity each Huntress severity opens at.
 */

// The step category it belongs to, and its group in the Add Trigger panel.
export const HUNTRESS_COMPONENT_CATEGORY: string = translationKey("Huntress");

const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.HuntressIncidentReport,
    title: translationKey("Huntress Incident Report"),
    category: HUNTRESS_COMPONENT_CATEGORY,
    description: translationKey(
      "Start this workflow when Huntress sends an incident report or an update.",
    ),
    iconProp: IconProp.ShieldCheck,
    componentType: ComponentType.Trigger,
    arguments: [
      {
        id: HuntressTriggerSetting.Organizations,
        name: translationKey("Only These Organizations"),
        description: translationKey(
          "The Huntress organizations whose reports start this workflow, one name or ID per line. Left empty, every organization's reports do.",
        ),
        type: ComponentInputType.LongText,
        required: false,
        placeholder: "Acme Corp",
        isAdvanced: true,
      },
      {
        id: HuntressTriggerSetting.CriticalIncidentSeverity,
        name: translationKey("Severity For Critical Reports"),
        description: translationKey(
          "The severity of the incidents that critical reports open. Left empty, it is the project's most severe.",
        ),
        type: ComponentInputType.IncidentSeveritySelect,
        required: false,
        placeholder: "The project's most severe",
        isAdvanced: true,
      },
      {
        id: HuntressTriggerSetting.HighIncidentSeverity,
        name: translationKey("Severity For High Reports"),
        description: translationKey(
          "The severity of the incidents that high reports open. Left empty, it is the project's second most severe.",
        ),
        type: ComponentInputType.IncidentSeveritySelect,
        required: false,
        placeholder: translationKey("The project's second most severe"),
        isAdvanced: true,
      },
      {
        id: HuntressTriggerSetting.LowIncidentSeverity,
        name: translationKey("Severity For Low Reports"),
        description: translationKey(
          "The severity of the incidents that low reports open. Left empty, it is the project's third most severe.",
        ),
        type: ComponentInputType.IncidentSeveritySelect,
        required: false,
        placeholder: translationKey("The project's third most severe"),
        isAdvanced: true,
      },
    ],
    /*
     * What Run Workflow asks for, to try the workflow without Huntress:
     * the values most steps read. The rest arrive empty.
     */
    runWorkflowManuallyArguments: [
      {
        id: HuntressTriggerValue.Event,
        name: translationKey("Event"),
        /*
         * Written out, so the Dashboard's locales can word it; a test holds
         * the events to the constants it names (WorkflowStepWords).
         */
        description: translationKey(
          "What happened: created, comment-added or closed. Empty: created.",
        ),
        type: ComponentInputType.Text,
        required: false,
        placeholder: HuntressTriggerEvent.Created,
      },
      {
        id: HuntressTriggerValue.ReportId,
        name: translationKey("Report ID"),
        description: translationKey(
          "The incident report's number. Use the same one to follow a report from created to closed.",
        ),
        type: ComponentInputType.Text,
        required: true,
        placeholder: "1234",
      },
      {
        id: HuntressTriggerValue.Severity,
        name: translationKey("Severity"),
        description: translationKey("critical, high or low. Empty: high."),
        type: ComponentInputType.Text,
        required: false,
        placeholder: "critical",
      },
      {
        id: HuntressTriggerValue.Organization,
        name: translationKey("Organization"),
        description: translationKey(
          "The Huntress organization the report is about.",
        ),
        type: ComponentInputType.Text,
        required: false,
        placeholder: "Acme Corp",
      },
      {
        id: HuntressTriggerValue.Subject,
        name: translationKey("Subject"),
        description: translationKey(
          "The report's subject, as Huntress writes it.",
        ),
        type: ComponentInputType.Text,
        required: false,
        placeholder: "CRITICAL - Incident on DESKTOP-01 (Acme Corp)",
      },
      {
        id: HuntressTriggerValue.Comment,
        name: translationKey("Comment"),
        description: translationKey("The comment, for a comment-added event."),
        type: ComponentInputType.LongText,
        required: false,
      },
    ],
    returnValues: [
      {
        id: HuntressTriggerValue.Event,
        name: translationKey("Event"),
        description: translationKey(
          "What happened: created for a new report, comment-added when someone commented on it, closed when it was closed or dismissed.",
        ),
        type: ComponentInputType.Text,
        required: true,
        placeholder: HuntressTriggerEvent.Created,
      },
      {
        id: HuntressTriggerValue.ReportId,
        name: translationKey("Report ID"),
        description: translationKey(
          "The incident report's number in Huntress.",
        ),
        type: ComponentInputType.Text,
        required: true,
        placeholder: "1234",
      },
      {
        id: HuntressTriggerValue.Severity,
        name: translationKey("Severity"),
        description: translationKey(
          "critical, high or low, as Huntress rates the report. A report that names none is high.",
        ),
        type: ComponentInputType.Text,
        required: true,
        placeholder: "critical",
      },
      {
        id: HuntressTriggerValue.Status,
        name: translationKey("Status"),
        description: translationKey(
          "The report's status in Huntress, such as sent, closed or dismissed.",
        ),
        type: ComponentInputType.Text,
        required: false,
        placeholder: "sent",
      },
      {
        id: HuntressTriggerValue.Subject,
        name: translationKey("Subject"),
        description: translationKey(
          "The report's subject, as Huntress writes it.",
        ),
        type: ComponentInputType.Text,
        required: false,
        placeholder: "CRITICAL - Incident on DESKTOP-01 (Acme Corp)",
      },
      {
        id: HuntressTriggerValue.Summary,
        name: translationKey("Summary"),
        description: translationKey(
          "What the SOC analyst wrote: what happened and what to do. Incident Description holds it ready for Markdown.",
        ),
        type: ComponentInputType.LongText,
        required: false,
      },
      {
        id: HuntressTriggerValue.Organization,
        name: translationKey("Organization"),
        description: translationKey(
          "The Huntress organization the report is about.",
        ),
        type: ComponentInputType.Text,
        required: false,
        placeholder: "Acme Corp",
      },
      {
        id: HuntressTriggerValue.OrganizationId,
        name: translationKey("Organization ID"),
        description: translationKey("The organization's number in Huntress."),
        type: ComponentInputType.Text,
        required: false,
        placeholder: "4",
      },
      {
        id: HuntressTriggerValue.Affected,
        name: translationKey("Affected"),
        description: translationKey(
          "The host or identity the report is about, read from its subject.",
        ),
        type: ComponentInputType.Text,
        required: false,
        placeholder: "DESKTOP-01",
      },
      {
        id: HuntressTriggerValue.Platform,
        name: translationKey("Platform"),
        description: translationKey(
          "Where Huntress found it, such as Windows or Microsoft 365.",
        ),
        type: ComponentInputType.Text,
        required: false,
        placeholder: "Windows",
      },
      {
        id: HuntressTriggerValue.Indicators,
        name: translationKey("Indicators"),
        description: translationKey(
          "What Huntress found, with how many of each.",
        ),
        type: ComponentInputType.Text,
        required: false,
        placeholder: "Footholds (1), Process detections (2)",
      },
      {
        id: HuntressTriggerValue.Comment,
        name: translationKey("Comment"),
        description: translationKey(
          "The comment someone added in Huntress. Empty unless Event is comment-added.",
        ),
        type: ComponentInputType.LongText,
        required: false,
      },
      {
        id: HuntressTriggerValue.ReportUrl,
        name: translationKey("Report URL"),
        description: translationKey("Where the report opens in Huntress."),
        type: ComponentInputType.URL,
        required: false,
        placeholder: "https://huntress.io/org/4/incident_reports/1234",
      },
      {
        id: HuntressTriggerValue.IncidentTitle,
        name: translationKey("Incident Title"),
        description: translationKey(
          "A title for an incident about the report: Huntress: and its subject.",
        ),
        type: ComponentInputType.Text,
        required: true,
        placeholder: "Huntress: Incident on DESKTOP-01 (Acme Corp)",
      },
      {
        id: HuntressTriggerValue.IncidentDescription,
        name: translationKey("Incident Description"),
        description: translationKey(
          "Markdown for the incident's description: the summary, the facts and a link to the report.",
        ),
        type: ComponentInputType.Markdown,
        required: true,
      },
      {
        id: HuntressTriggerValue.Note,
        name: translationKey("Note"),
        description: translationKey(
          "Markdown for a note about this event: the comment, or that Huntress closed the report. Empty for a new report.",
        ),
        type: ComponentInputType.Markdown,
        required: false,
      },
      {
        id: HuntressTriggerValue.IncidentSeverityId,
        name: translationKey("Incident Severity ID"),
        description: translationKey(
          "The incident severity the report opens at: the one its severity's setting picks, or the project's severities in rank order.",
        ),
        type: ComponentInputType.Text,
        required: false,
      },
      {
        id: HuntressTriggerValue.OrganizationLabelId,
        name: translationKey("Organization Label ID"),
        description: translationKey(
          "The label named after the organization, made the first time it is needed, so incident rules can tell organizations apart.",
        ),
        type: ComponentInputType.Text,
        required: false,
      },
      {
        id: HuntressTriggerValue.ReceivedAt,
        name: translationKey("Received At"),
        description: translationKey("When OneUptime received the event."),
        type: ComponentInputType.DateTime,
        required: true,
      },
    ],
    inPorts: [],
    outPorts: [
      {
        title: translationKey("Out"),
        description: translationKey(
          "Connect the steps to run for each event Huntress sends about a report.",
        ),
        id: "out",
      },
    ],
  },
];

export default components;
