import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import { MarkdownText, mdText } from "../../../Utils/Markdown/FeedMarkdown";

/*
 * WHAT AN INCIDENT'S FEED, AND ITS SLACK AND TEAMS CHANNELS, SAY WHEN
 * SOMEBODY IS GIVEN A ROLE ON IT OR TAKEN OFF ONE (Responder, Observer,
 * Incident Commander and every role a project defines).
 *
 * The entry is written for whoever made the change: its author is them -
 * the person (the feed shows their name in front of the sentence, and the
 * chat message opens with it), or the project API key - so the sentence is
 * written to follow a name: "added Deane Looi as Responder to Incident
 * INC-18". Who acts is never the person the entry is about: a channel once
 * read "Deane Looi Added Deane Looi as Responder" after somebody else added
 * Deane in the Dashboard, because the message opened with the person it was
 * about (FeedWorkspaceNotification).
 *
 * The other ways a role changes name what did it in the sentence itself,
 * since they have no author:
 *
 *   - a workflow's step: "Workflow Page SRE added Deane Looi as Responder
 *     to Incident INC-18";
 *   - a monitor whose criteria give its incidents people in roles: "Monitor
 *     API Health added Deane Looi as Responder to Incident INC-18";
 *   - OneUptime itself, making the first person to change an incident's
 *     state its Incident Commander: "Deane Looi became the Incident
 *     Commander of Incident INC-18 when they changed its state to
 *     Acknowledged".
 *
 * And a person who gives themselves a role, or takes themselves off one,
 * reads as doing so - "Valeria took the Incident Commander role on Incident
 * INC-18", "Valeria left the Responder role" - not "Valeria added Valeria".
 *
 * React-free and database-free, so the words can be tested on their own.
 */

/*
 * Why OneUptime gave somebody a role by itself, as the entry says so. Handed
 * to IncidentMemberService's create through miscDataProps
 * (IncidentRoleFeedText.toMiscDataProps), and read back only for a write
 * OneUptime makes itself (props.isRoot) - never from a request, which could
 * otherwise make an entry say OneUptime did what a person did.
 */
export type IncidentRoleAssignmentCause =
  | {
      // The first person to change the incident's state: its commander.
      kind: "stateChange";
      // The state they changed it to, by the name it has.
      stateName: string;
    }
  | {
      // A monitor's criteria that give the incidents it declares roles.
      kind: "monitor";
      monitorName: string;
    };

// Where the cause rides in miscDataProps.
export const INCIDENT_ROLE_CAUSE_KEY: string = "incidentRoleAssignmentCause";

export interface IncidentRoleFeedTextInput {
  // The role, by the name the project gave it: "Responder".
  roleName: string;
  // The incident, as a link to it: [Incident INC-18](...).
  incident: MarkdownText;
  /*
   * Whether the person given the role, or taken off it, is the one who did
   * it. Only a person can be: a key, a workflow or OneUptime is no one.
   */
  isSelf: boolean;
  // The workflow whose step made the change, by the name it had then.
  workflowName?: string | undefined;
}

export interface IncidentRoleAddedFeedTextInput
  extends IncidentRoleFeedTextInput {
  // The person given the role, as a link to them: [Deane Looi](...).
  person: MarkdownText;
  cause?: IncidentRoleAssignmentCause | null | undefined;
}

export interface IncidentRoleRemovedFeedTextInput
  extends IncidentRoleFeedTextInput {
  /*
   * The person taken off the role, as a link to them - named as the line
   * that gave them the role names them, not by name and email: "Removed
   * Deane Looi (deane.looi@...) as Responder" ran across two lines of a
   * phone's channel.
   */
  person: MarkdownText;
}

/*
 * A role handed from one person to another in one change (Reassign): the
 * person who held it and the person who holds it now, each as a link to
 * them. Who made the change may be either of them - somebody who takes the
 * role over, or hands it on - or somebody else.
 */
export interface IncidentRoleReassignedFeedTextInput {
  roleName: string;
  incident: MarkdownText;
  /*
   * The person who held the role: empty for a person who is gone, whom
   * nobody is named for.
   */
  from: MarkdownText;
  // The person who holds it now.
  to: MarkdownText;
  // Who made the change, when it was one of the two.
  madeBy?: "from" | "to" | undefined;
  workflowName?: string | undefined;
}

/*
 * A person moved from one role to another in one change (#10274): the row
 * keeps its person and its incident, and names another role - through the
 * API, Terraform or a workflow's Update step.
 */
export interface IncidentRoleMovedFeedTextInput {
  // The person moved, as a link to them.
  person: MarkdownText;
  // The role they held, and the one they hold now, by the project's names.
  fromRoleName: string;
  toRoleName: string;
  incident: MarkdownText;
  // Whether the person moved is the one who moved themselves.
  isSelf: boolean;
  workflowName?: string | undefined;
}

const getWorkflowName: (input: {
  workflowName?: string | undefined;
}) => string = (input: { workflowName?: string | undefined }): string => {
  return (input.workflowName || "").trim();
};

export default class IncidentRoleFeedText {
  // The entry for somebody given a role on an incident.
  public static getAddedMarkdown(
    input: IncidentRoleAddedFeedTextInput,
  ): MarkdownText {
    const cause: IncidentRoleAssignmentCause | null = input.cause || null;

    if (cause?.kind === "stateChange" && cause.stateName.trim()) {
      return mdText`👤 **${input.person}** became the **${input.roleName}** of ${input.incident} when they changed its state to **${cause.stateName.trim()}**.`;
    }

    if (cause?.kind === "monitor" && cause.monitorName.trim()) {
      return mdText`👤 Monitor **${cause.monitorName.trim()}** added **${input.person}** as **${input.roleName}** to ${input.incident}.`;
    }

    const workflowName: string = getWorkflowName(input);

    if (workflowName) {
      return mdText`👤 Workflow **${workflowName}** added **${input.person}** as **${input.roleName}** to ${input.incident}.`;
    }

    if (input.isSelf) {
      return mdText`👤 Took the **${input.roleName}** role on ${input.incident}.`;
    }

    return mdText`👤 Added **${input.person}** as **${input.roleName}** to ${input.incident}.`;
  }

  // The entry for somebody taken off a role on an incident.
  public static getRemovedMarkdown(
    input: IncidentRoleRemovedFeedTextInput,
  ): MarkdownText {
    const workflowName: string = getWorkflowName(input);

    if (workflowName) {
      return mdText`👤 Workflow **${workflowName}** removed **${input.person}** as **${input.roleName}** from ${input.incident}.`;
    }

    if (input.isSelf) {
      return mdText`👤 Left the **${input.roleName}** role on ${input.incident}.`;
    }

    return mdText`👤 Removed **${input.person}** as **${input.roleName}** from ${input.incident}.`;
  }

  /*
   * The entry for a role handed from one person to another in one change
   * (Reassign): one entry, never a removal and an addition, since the role
   * was never without someone. "Reassigned Incident Commander on Incident
   * INC-18 from Maya Chen to Jordan Patel"; somebody taking it over reads
   * "Took over ... from Maya Chen", and somebody handing it on "Handed ...
   * to Jordan Patel".
   */
  public static getReassignedMarkdown(
    input: IncidentRoleReassignedFeedTextInput,
  ): MarkdownText {
    const workflowName: string = getWorkflowName(input);
    const hasFrom: boolean = !input.from.isEmpty();

    if (workflowName) {
      return hasFrom
        ? mdText`👤 Workflow **${workflowName}** reassigned **${input.roleName}** on ${input.incident} from **${input.from}** to **${input.to}**.`
        : mdText`👤 Workflow **${workflowName}** reassigned **${input.roleName}** on ${input.incident} to **${input.to}**.`;
    }

    if (input.madeBy === "to") {
      return hasFrom
        ? mdText`👤 Took over the **${input.roleName}** role on ${input.incident} from **${input.from}**.`
        : mdText`👤 Took the **${input.roleName}** role on ${input.incident}.`;
    }

    if (input.madeBy === "from") {
      return mdText`👤 Handed the **${input.roleName}** role on ${input.incident} to **${input.to}**.`;
    }

    return hasFrom
      ? mdText`👤 Reassigned **${input.roleName}** on ${input.incident} from **${input.from}** to **${input.to}**.`
      : mdText`👤 Reassigned **${input.roleName}** on ${input.incident} to **${input.to}**.`;
  }

  /*
   * The entry for a person moved to another role in one change (#10274):
   * one entry, never a removal and an addition, since they held a role all
   * along. "Moved Maya Chen from Responder to Incident Commander on
   * Incident INC-18"; somebody moving themselves reads "Moved from
   * Responder to Incident Commander ...", after their name.
   */
  public static getMovedMarkdown(
    input: IncidentRoleMovedFeedTextInput,
  ): MarkdownText {
    const workflowName: string = getWorkflowName(input);

    if (workflowName) {
      return mdText`👤 Workflow **${workflowName}** moved **${input.person}** from **${input.fromRoleName}** to **${input.toRoleName}** on ${input.incident}.`;
    }

    if (input.isSelf) {
      return mdText`👤 Moved from **${input.fromRoleName}** to **${input.toRoleName}** on ${input.incident}.`;
    }

    return mdText`👤 Moved **${input.person}** from **${input.fromRoleName}** to **${input.toRoleName}** on ${input.incident}.`;
  }

  /*
   * The workflow that made a change, when no person and no API key did: a
   * workflow's step acts with props that name it (WorkflowPrincipal), and
   * a person's or a key's write never carries one.
   */
  public static getWorkflowName(
    props: DatabaseCommonInteractionProps | null | undefined,
  ): string | undefined {
    if (!props || props.userId || props.apiKeyId) {
      return undefined;
    }

    return (props.workflowName || "").trim() || undefined;
  }

  // The miscDataProps that carry why OneUptime gives somebody a role.
  public static toMiscDataProps(
    cause: IncidentRoleAssignmentCause,
  ): JSONObject {
    return {
      [INCIDENT_ROLE_CAUSE_KEY]: { ...cause } as unknown as JSONObject,
    };
  }

  /*
   * Why OneUptime gave the role, from a create's miscDataProps - for
   * OneUptime's own write only (props.isRoot): a request's miscDataProps
   * never says so.
   */
  public static readCause(data: {
    miscDataProps?: JSONObject | null | undefined;
    props: DatabaseCommonInteractionProps;
  }): IncidentRoleAssignmentCause | null {
    if (!data.props.isRoot || !data.miscDataProps) {
      return null;
    }

    const value: unknown = data.miscDataProps[INCIDENT_ROLE_CAUSE_KEY];

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const cause: Record<string, unknown> = value as Record<string, unknown>;

    if (
      cause["kind"] === "stateChange" &&
      typeof cause["stateName"] === "string" &&
      cause["stateName"].trim()
    ) {
      return { kind: "stateChange", stateName: cause["stateName"] };
    }

    if (
      cause["kind"] === "monitor" &&
      typeof cause["monitorName"] === "string" &&
      cause["monitorName"].trim()
    ) {
      return { kind: "monitor", monitorName: cause["monitorName"] };
    }

    return null;
  }
}
