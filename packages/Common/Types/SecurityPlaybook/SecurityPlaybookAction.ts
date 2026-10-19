import IconProp from "../Icon/IconProp";
import SecurityEventConnectorProvider from "../SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { SecurityEntityType } from "../SecurityCase/SecurityEntity";

/*
 * What a playbook step can do. Each action is one verb an analyst would
 * otherwise do by hand on a case: change the case, look something up, tell
 * somebody, escalate it, contain a threat through a connected product, or
 * hand the case to something else.
 */
export enum SecurityPlaybookActionType {
  // Case
  AssignCase = "Assign Case",
  SetCasePriority = "Set Case Priority",
  SetCaseStatus = "Set Case Status",
  AddCaseNote = "Add Case Note",
  AddCaseLabels = "Add Case Labels",

  // Investigate
  CheckThreatIntel = "Check Threat Intel",
  LookUpEntityActivity = "Look Up Entity Activity",

  // Notify
  EmailPeople = "Email People",
  PostToSlack = "Post to Slack",
  PostToMicrosoftTeams = "Post to Microsoft Teams",

  // Escalate
  PageOnCall = "Page On-Call",
  DeclareIncident = "Declare Incident",

  // Contain
  SuspendOktaUser = "Suspend Okta User",
  EndOktaSessions = "End Okta Sessions",
  ContainCrowdStrikeHost = "Contain CrowdStrike Host",
  IsolateDefenderDevice = "Isolate Defender Device",

  // Automate
  SendWebhook = "Send Webhook",
  RunWorkflow = "Run Workflow",
}

export enum SecurityPlaybookActionCategory {
  Case = "Case",
  Investigate = "Investigate",
  Notify = "Notify",
  Escalate = "Escalate",
  Contain = "Contain",
  Automate = "Automate",
}

// The order the step picker shows the categories in: the order of a response.
export const SECURITY_PLAYBOOK_ACTION_CATEGORIES: ReadonlyArray<SecurityPlaybookActionCategory> =
  [
    SecurityPlaybookActionCategory.Case,
    SecurityPlaybookActionCategory.Investigate,
    SecurityPlaybookActionCategory.Notify,
    SecurityPlaybookActionCategory.Escalate,
    SecurityPlaybookActionCategory.Contain,
    SecurityPlaybookActionCategory.Automate,
  ];

export interface SecurityPlaybookActionDefinition {
  type: SecurityPlaybookActionType;
  // A verb phrase, as the step list reads: "Assign the case".
  title: string;
  description: string;
  category: SecurityPlaybookActionCategory;
  icon: IconProp;
  /*
   * Changes something outside OneUptime that a person would want to see
   * first: suspending an account, cutting a host off the network. The step
   * editor turns on "Needs approval" for these by default.
   */
  isDisruptive: boolean;
  // The connected product it acts through, for the actions that act on one.
  connectionProvider?: SecurityEventConnectorProvider | undefined;
  // The case entities it acts on, for the actions that act on entities.
  entityType?: SecurityEntityType | undefined;
}

export const SECURITY_PLAYBOOK_ACTIONS: ReadonlyArray<SecurityPlaybookActionDefinition> =
  [
    {
      type: SecurityPlaybookActionType.AssignCase,
      title: "Assign the case",
      description:
        "Give the case to a person, a team, or both, so it lands in somebody's queue.",
      category: SecurityPlaybookActionCategory.Case,
      icon: IconProp.User,
      isDisruptive: false,
    },
    {
      type: SecurityPlaybookActionType.SetCasePriority,
      title: "Set the priority",
      description: "Raise or lower the case's priority.",
      category: SecurityPlaybookActionCategory.Case,
      icon: IconProp.Flag,
      isDisruptive: false,
    },
    {
      type: SecurityPlaybookActionType.SetCaseStatus,
      title: "Set the status",
      description:
        "Move the case to Investigating, Contained or Closed. Closing sets the verdict you choose.",
      category: SecurityPlaybookActionCategory.Case,
      icon: IconProp.CheckCircle,
      isDisruptive: false,
    },
    {
      type: SecurityPlaybookActionType.AddCaseNote,
      title: "Add a note",
      description:
        "Write a note on the case: a checklist for the analyst, a reminder, or what to check first.",
      category: SecurityPlaybookActionCategory.Case,
      icon: IconProp.Book,
      isDisruptive: false,
    },
    {
      type: SecurityPlaybookActionType.AddCaseLabels,
      title: "Add labels",
      description: "Tag the case with labels, to filter and report on it.",
      category: SecurityPlaybookActionCategory.Case,
      icon: IconProp.Tag,
      isDisruptive: false,
    },
    {
      type: SecurityPlaybookActionType.CheckThreatIntel,
      title: "Check entities against threat intel",
      description:
        "Look every entity of the case up in your threat intel feeds and note what is known-bad. Can raise the priority on a match, and later steps can run only when something matched.",
      category: SecurityPlaybookActionCategory.Investigate,
      icon: IconProp.ShieldExclamation,
      isDisruptive: false,
    },
    {
      type: SecurityPlaybookActionType.LookUpEntityActivity,
      title: "Look up entity activity",
      description:
        "Count each entity's security events over a recent window, with when it was first and last seen, and note it on the case.",
      category: SecurityPlaybookActionCategory.Investigate,
      icon: IconProp.Search,
      isDisruptive: false,
    },
    {
      type: SecurityPlaybookActionType.EmailPeople,
      title: "Email people",
      description:
        "Email users and teams a summary of the case with a link to it.",
      category: SecurityPlaybookActionCategory.Notify,
      icon: IconProp.Email,
      isDisruptive: false,
    },
    {
      type: SecurityPlaybookActionType.PostToSlack,
      title: "Post to Slack",
      description:
        "Post a summary of the case to a Slack channel, through the project's Slack connection.",
      category: SecurityPlaybookActionCategory.Notify,
      icon: IconProp.Slack,
      isDisruptive: false,
    },
    {
      type: SecurityPlaybookActionType.PostToMicrosoftTeams,
      title: "Post to Microsoft Teams",
      description:
        "Post a summary of the case to a Microsoft Teams channel, through the project's Microsoft Teams connection.",
      category: SecurityPlaybookActionCategory.Notify,
      icon: IconProp.MicrosoftTeams,
      isDisruptive: false,
    },
    {
      type: SecurityPlaybookActionType.PageOnCall,
      title: "Page on-call",
      description:
        "Run an on-call policy, so whoever is on call is notified and escalated to until somebody acknowledges.",
      category: SecurityPlaybookActionCategory.Escalate,
      icon: IconProp.Call,
      isDisruptive: false,
    },
    {
      type: SecurityPlaybookActionType.DeclareIncident,
      title: "Declare an incident",
      description:
        "Open a OneUptime incident linked to the case, for a breach that needs your incident process: on-call, workspace channels, status page and postmortem.",
      category: SecurityPlaybookActionCategory.Escalate,
      icon: IconProp.Alert,
      isDisruptive: false,
    },
    {
      type: SecurityPlaybookActionType.SuspendOktaUser,
      title: "Suspend the user in Okta",
      description:
        "Suspend each user of the case in Okta, which signs them out and blocks sign-in until they are unsuspended.",
      category: SecurityPlaybookActionCategory.Contain,
      icon: IconProp.Lock,
      isDisruptive: true,
      connectionProvider: SecurityEventConnectorProvider.OktaSystemLog,
      entityType: SecurityEntityType.User,
    },
    {
      type: SecurityPlaybookActionType.EndOktaSessions,
      title: "End the user's Okta sessions",
      description:
        "Sign each user of the case out of Okta everywhere and revoke their tokens, without suspending the account.",
      category: SecurityPlaybookActionCategory.Contain,
      icon: IconProp.Logout,
      isDisruptive: true,
      connectionProvider: SecurityEventConnectorProvider.OktaSystemLog,
      entityType: SecurityEntityType.User,
    },
    {
      type: SecurityPlaybookActionType.ContainCrowdStrikeHost,
      title: "Contain the host in CrowdStrike",
      description:
        "Network-contain each host of the case with CrowdStrike Falcon: it can reach only the Falcon cloud until containment is lifted.",
      category: SecurityPlaybookActionCategory.Contain,
      icon: IconProp.ShieldCheck,
      isDisruptive: true,
      connectionProvider: SecurityEventConnectorProvider.CrowdStrikeFalcon,
      entityType: SecurityEntityType.Host,
    },
    {
      type: SecurityPlaybookActionType.IsolateDefenderDevice,
      title: "Isolate the device in Microsoft Defender",
      description:
        "Isolate each host of the case with Microsoft Defender for Endpoint, cutting it off the network except for Defender itself.",
      category: SecurityPlaybookActionCategory.Contain,
      icon: IconProp.ShieldCheck,
      isDisruptive: true,
      connectionProvider: SecurityEventConnectorProvider.MicrosoftDefenderXdr,
      entityType: SecurityEntityType.Host,
    },
    {
      type: SecurityPlaybookActionType.SendWebhook,
      title: "Send a webhook",
      description:
        "POST the case as JSON to a URL: a ticketing system, a firewall's API gateway, or your own automation.",
      category: SecurityPlaybookActionCategory.Automate,
      icon: IconProp.Webhook,
      isDisruptive: false,
    },
    {
      type: SecurityPlaybookActionType.RunWorkflow,
      title: "Run a workflow",
      description:
        "Start a OneUptime workflow with the case as its input, for anything a workflow's integrations can do.",
      category: SecurityPlaybookActionCategory.Automate,
      icon: IconProp.Workflow,
      isDisruptive: false,
    },
  ];

export function getSecurityPlaybookAction(
  type: SecurityPlaybookActionType | string | undefined | null,
): SecurityPlaybookActionDefinition | undefined {
  return SECURITY_PLAYBOOK_ACTIONS.find(
    (action: SecurityPlaybookActionDefinition): boolean => {
      return action.type === type;
    },
  );
}

/*
 * The categories whose steps only read and write the case inside OneUptime:
 * nobody is told, paged or escalated to, and nothing outside is changed.
 */
export const SECURITY_PLAYBOOK_INSIDE_CATEGORIES: ReadonlyArray<SecurityPlaybookActionCategory> =
  [
    SecurityPlaybookActionCategory.Case,
    SecurityPlaybookActionCategory.Investigate,
  ];

/*
 * Whether every step of a playbook's stored steps stays inside OneUptime. A
 * step this cannot read counts as one that does not, so the answer errs on
 * the side of not running.
 */
export function doStepsStayInsideOneUptime(steps: unknown): boolean {
  if (!Array.isArray(steps)) {
    return false;
  }

  return steps.every((step: unknown): boolean => {
    if (!step || typeof step !== "object" || Array.isArray(step)) {
      return false;
    }

    const action: SecurityPlaybookActionDefinition | undefined =
      getSecurityPlaybookAction(
        (step as { action?: unknown }).action as string | undefined,
      );

    return Boolean(
      action && SECURITY_PLAYBOOK_INSIDE_CATEGORIES.includes(action.category),
    );
  });
}

export function isSecurityPlaybookActionType(
  value: unknown,
): value is SecurityPlaybookActionType {
  return (
    typeof value === "string" &&
    (Object.values(SecurityPlaybookActionType) as Array<string>).includes(value)
  );
}
