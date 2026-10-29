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
  PreserveEvidence = "Preserve Evidence",

  // Notify
  EmailPeople = "Email People",
  NotifyDataStoreOwners = "Notify Data Store Owners",
  PostToSlack = "Post to Slack",
  PostToMicrosoftTeams = "Post to Microsoft Teams",
  PostStatusPageAnnouncement = "Post Status Page Announcement",

  // Escalate
  PageOnCall = "Page On-Call",
  DeclareIncident = "Declare Incident",

  // Contain
  SuspendOktaUser = "Suspend Okta User",
  EndOktaSessions = "End Okta Sessions",
  ContainCrowdStrikeHost = "Contain CrowdStrike Host",
  IsolateDefenderDevice = "Isolate Defender Device",
  UnsuspendOktaUser = "Unsuspend Okta User",
  LiftCrowdStrikeContainment = "Lift CrowdStrike Containment",
  ReleaseDefenderDevice = "Release Defender Device",
  BlockDataStorePublicAccess = "Block Data Store Public Access",
  RevokeDataStoreSharing = "Revoke Data Store Sharing",

  // Automate
  SendWebhook = "Send Webhook",
  RunWorkflow = "Run Workflow",
  RunRunbook = "Run Runbook",
  FixWithAi = "Fix With AI",
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
   * Cuts somebody or something off: suspending an account, cutting a host
   * off the network. A step of one of these waits for a person's approval,
   * unless a Security Admin turned that off (doesStepNeedApproval).
   */
  isDisruptive: boolean;
  // The connected product it acts through, for the actions that act on one.
  connectionProvider?: SecurityEventConnectorProvider | undefined;
  /*
   * The kind of entity it acts on, for the actions that act on the case's
   * users or hosts: only the ones the case is about (SecurityPlaybookTargets).
   */
  entityType?: SecurityEntityType | undefined;
  // For an action that undoes a containment action: the action it undoes.
  undoes?: SecurityPlaybookActionType | undefined;
  /*
   * A new step of it starts needing approval, though nothing about it cuts
   * anyone off: it runs commands on the project's own systems, or speaks to
   * its customers. Whoever adds the step may turn that off.
   */
  needsApprovalByDefault?: boolean | undefined;
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
        "Move the case to one of the project's statuses, such as Investigating, Contained or Closed. Closing sets the verdict you choose.",
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
      type: SecurityPlaybookActionType.PreserveEvidence,
      title: "Preserve the evidence",
      description:
        "Keep the session replays of the requests behind the case past their retention, and note on the case the traces, sessions and exceptions those requests link to.",
      category: SecurityPlaybookActionCategory.Investigate,
      icon: IconProp.Archive,
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
      type: SecurityPlaybookActionType.NotifyDataStoreOwners,
      title: "Notify data store owners",
      description:
        "Email the owners of each data store the case is about, as Data Security lists them, with the store and a link to the case.",
      category: SecurityPlaybookActionCategory.Notify,
      icon: IconProp.Database,
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
      type: SecurityPlaybookActionType.PostStatusPageAnnouncement,
      title: "Post a status page announcement",
      description:
        "Publish an announcement on your status pages, for an attack your customers should hear about from you first. Waits for approval unless you turn that off.",
      category: SecurityPlaybookActionCategory.Notify,
      icon: IconProp.Announcement,
      isDisruptive: false,
      needsApprovalByDefault: true,
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
        "Suspend in Okta the user the case is about: the one its detections are grouped on, or one threat intel knows. Signs them out and blocks sign-in until they are unsuspended.",
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
        "Sign the user the case is about out of Okta everywhere and revoke their tokens, without suspending the account.",
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
        "Network-contain the host the case is about with CrowdStrike Falcon: it can reach only the Falcon cloud until containment is lifted.",
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
        "Isolate the host the case is about with Microsoft Defender for Endpoint, cutting it off the network except for Defender itself.",
      category: SecurityPlaybookActionCategory.Contain,
      icon: IconProp.ShieldCheck,
      isDisruptive: true,
      connectionProvider: SecurityEventConnectorProvider.MicrosoftDefenderXdr,
      entityType: SecurityEntityType.Host,
    },
    {
      type: SecurityPlaybookActionType.UnsuspendOktaUser,
      title: "Unsuspend the user in Okta",
      description:
        "Unsuspend in Okta the user the case is about, so they can sign in again: the undo of Suspend the user in Okta.",
      category: SecurityPlaybookActionCategory.Contain,
      icon: IconProp.LockOpen,
      isDisruptive: false,
      connectionProvider: SecurityEventConnectorProvider.OktaSystemLog,
      entityType: SecurityEntityType.User,
      undoes: SecurityPlaybookActionType.SuspendOktaUser,
    },
    {
      type: SecurityPlaybookActionType.LiftCrowdStrikeContainment,
      title: "Lift containment in CrowdStrike",
      description:
        "Lift CrowdStrike Falcon's network containment from the host the case is about, so it reaches the network again.",
      category: SecurityPlaybookActionCategory.Contain,
      icon: IconProp.LockOpen,
      isDisruptive: false,
      connectionProvider: SecurityEventConnectorProvider.CrowdStrikeFalcon,
      entityType: SecurityEntityType.Host,
      undoes: SecurityPlaybookActionType.ContainCrowdStrikeHost,
    },
    {
      type: SecurityPlaybookActionType.ReleaseDefenderDevice,
      title: "Release the device in Microsoft Defender",
      description:
        "Release the host the case is about from isolation in Microsoft Defender for Endpoint, so it reaches the network again.",
      category: SecurityPlaybookActionCategory.Contain,
      icon: IconProp.LockOpen,
      isDisruptive: false,
      connectionProvider: SecurityEventConnectorProvider.MicrosoftDefenderXdr,
      entityType: SecurityEntityType.Host,
      undoes: SecurityPlaybookActionType.IsolateDefenderDevice,
    },
    /*
     * A data store's exposure, closed through its cloud connection's "Data
     * security response" role (Server/Utils/DataSecurity/
     * DataSecurityResponse): the stores the case is about, never one marked
     * public by design. They cut nobody off, but they change a cloud's
     * settings - a public website stops being public - so a new step starts
     * needing approval, which whoever adds it may turn off.
     */
    {
      type: SecurityPlaybookActionType.BlockDataStorePublicAccess,
      title: "Block public access to data stores",
      description:
        "Block public access to each bucket or storage account the case is about, through its cloud connection. A store marked public by design is left alone.",
      category: SecurityPlaybookActionCategory.Contain,
      icon: IconProp.Lock,
      isDisruptive: false,
      needsApprovalByDefault: true,
    },
    {
      type: SecurityPlaybookActionType.RevokeDataStoreSharing,
      title: "Revoke data store sharing",
      description:
        "Stop sharing the snapshots of each database the case is about with everyone and with accounts outside the project's, through its cloud connection.",
      category: SecurityPlaybookActionCategory.Contain,
      icon: IconProp.Lock,
      isDisruptive: false,
      needsApprovalByDefault: true,
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
    {
      type: SecurityPlaybookActionType.RunRunbook,
      title: "Run a runbook",
      description:
        "Start one of your OneUptime runbooks with the case's users, hosts and addresses as its inputs: block an address, stop a process, cordon a node. Waits for approval unless you turn that off.",
      category: SecurityPlaybookActionCategory.Automate,
      icon: IconProp.CommandLine,
      isDisruptive: false,
      needsApprovalByDefault: true,
    },
    {
      type: SecurityPlaybookActionType.FixWithAi,
      title: "Fix the code with AI",
      description:
        "Ask OneUptime AI to fix the code behind the exceptions the case's requests threw, as a pull request on the repository that holds it.",
      category: SecurityPlaybookActionCategory.Automate,
      icon: IconProp.Sparkles,
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

// Whether a step of this action acts on the case's users or hosts through a connected product.
export function actsOnSecurityEntities(
  definition: SecurityPlaybookActionDefinition | undefined,
): boolean {
  return Boolean(definition?.connectionProvider && definition.entityType);
}

/*
 * Whether a new step of this action starts needing approval: a containment
 * step, and a step that runs commands or speaks to customers.
 */
export function doesActionNeedApprovalByDefault(
  definition: SecurityPlaybookActionDefinition | undefined,
): boolean {
  return Boolean(
    definition?.isDisruptive || definition?.needsApprovalByDefault,
  );
}

/*
 * The action that undoes a containment action - Unsuspend for Suspend - or
 * undefined for one nothing undoes (a session that was ended stays ended).
 */
export function getSecurityPlaybookUndoAction(
  type: SecurityPlaybookActionType | string | undefined | null,
): SecurityPlaybookActionDefinition | undefined {
  if (!type) {
    return undefined;
  }

  return SECURITY_PLAYBOOK_ACTIONS.find(
    (action: SecurityPlaybookActionDefinition): boolean => {
      return action.undoes === type;
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
