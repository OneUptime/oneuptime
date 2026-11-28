/*
 * WHERE AN INCIDENT SOMEONE DECLARES BY HAND STARTS (#11137).
 *
 * Every new incident starts in its project's created state unless its
 * create names another (Declare Incident's Initial State, a template's
 * initial state, the API's currentIncidentStateId), and it waits there to be
 * acknowledged. For an incident a person declares themselves that is one
 * click too many: whoever declares it is already on it, and became its
 * Incident Commander as they declared it.
 *
 * Each project can say so: Project.startIncidentsDeclaredByHandAcknowledged,
 * the switch "Start incidents declared by hand acknowledged" on Incidents ->
 * Settings -> Incident State. It is off for every project, existing and new,
 * so nothing changes until a project owner or admin turns it on: a default
 * that pages nobody must never arrive with an upgrade.
 *
 * On, an incident declared by hand starts in the project's acknowledged
 * state - acknowledged by whoever declared it, so no one is paged
 * (Common/Utils/StartingStage) - when nothing else says where it starts:
 *
 *   - no state was picked for it, by the person (Initial State) or by the
 *     template it is declared from;
 *   - and it pages no on-call policy: the person picked none, and the
 *     template named none. An incident whose declarer asks for someone to be
 *     paged starts in the created state, so they are paged and acknowledge
 *     it themselves - Declare Incident says "the on-call policies to page as
 *     soon as the incident is declared", and that must stay true.
 *
 * On-call rules are not asked: they run once the incident exists, and an
 * incident that starts acknowledged runs no on-call policy, a rule's
 * included, as one declared acknowledged on purpose never has. The switch's
 * own words say so.
 *
 * "By hand" means a person declaring it in one of OneUptime's declare forms:
 * Declare Incident in the dashboard (from Incidents, an alert, a monitor or
 * any page that opens it), and Slack's and Microsoft Teams' Declare Incident
 * forms. Each sends miscDataProps[INCIDENT_DECLARED_BY_HAND_KEY] = true with
 * the create, and IncidentService decides from it on the server, with the
 * template and the on-call policies the create ends up with. Incidents
 * nobody declares by hand - a monitor's, an alert incident rule's, the API's,
 * Terraform's, a workflow's, a form's, a security case's - send nothing and
 * start in the created state, as they always did.
 *
 * Shared by the server, which decides, the dashboard, which says what will
 * happen before the person declares, and their tests.
 */

// The Project column that holds the switch.
export type StartIncidentsDeclaredByHandAcknowledgedColumn =
  "startIncidentsDeclaredByHandAcknowledged";

export const START_INCIDENTS_DECLARED_BY_HAND_ACKNOWLEDGED_COLUMN: StartIncidentsDeclaredByHandAcknowledgedColumn =
  "startIncidentsDeclaredByHandAcknowledged";

/*
 * Sent as `miscDataProps[INCIDENT_DECLARED_BY_HAND_KEY] = true` with an
 * incident create by the forms people declare incidents in. True or false;
 * anything else is refused. An API client may send it too: all it can do is
 * start its own incident where the project starts incidents declared by
 * hand, which it may pick outright with currentIncidentStateId anyway.
 */
export const INCIDENT_DECLARED_BY_HAND_KEY: string = "declaredByHand";

export interface StartIncidentsDeclaredByHandAcknowledgedSetting {
  startIncidentsDeclaredByHandAcknowledged?: boolean | null | undefined;
}

export interface IncidentDeclaredByHand {
  // Whether the project's switch is on (isOn).
  isSwitchOn: boolean;
  /*
   * Whether something already says where the incident starts: a state the
   * person picked, or the one the template it is declared from names.
   */
  hasStartingState: boolean;
  // How many on-call policies the declaration pages: picked, or a template's.
  onCallPolicyCount: number;
}

export default class IncidentDeclaredByHandStart {
  /*
   * Only an explicit "on" starts incidents declared by hand acknowledged. A
   * project that could not be read, or holds no value, starts them where
   * every incident starts: when OneUptime cannot tell, it keeps paging as it
   * always did.
   */
  public static isOn(
    project: StartIncidentsDeclaredByHandAcknowledgedSetting | null | undefined,
  ): boolean {
    return (
      project?.[START_INCIDENTS_DECLARED_BY_HAND_ACKNOWLEDGED_COLUMN] === true
    );
  }

  /*
   * Whether an incident declared by hand starts in the project's
   * acknowledged state: the switch is on, nothing names where it starts, and
   * it pages nobody.
   */
  public static startsAcknowledged(declared: IncidentDeclaredByHand): boolean {
    return (
      declared.isSwitchOn &&
      !declared.hasStartingState &&
      declared.onCallPolicyCount === 0
    );
  }

  /*
   * The on-call policies a create names, counted once each: models, `{ _id }`
   * objects or id strings, as the dashboard, the chats and the server hand
   * them over. An entry with no id names nothing and is not counted.
   */
  public static countOnCallPolicies(policies: unknown): number {
    if (!Array.isArray(policies)) {
      return 0;
    }

    const ids: Set<string> = new Set<string>();

    for (const policy of policies) {
      const id: string = this.readId(policy);

      if (id) {
        ids.add(id);
      }
    }

    return ids.size;
  }

  private static readId(value: unknown): string {
    if (value === null || value === undefined) {
      return "";
    }

    if (typeof value === "string") {
      return value.trim().toLowerCase();
    }

    if (typeof value !== "object") {
      return "";
    }

    const record: Record<string, unknown> = value as Record<string, unknown>;

    // An ObjectID, as the chats build their policies: its own value.
    if (typeof record["value"] === "string" && !("_id" in record)) {
      return (record["value"] as string).trim().toLowerCase();
    }

    const id: unknown = record["_id"] ?? record["id"];

    if (id === null || id === undefined) {
      return "";
    }

    if (typeof id === "string") {
      return id.trim().toLowerCase();
    }

    return this.readId(id);
  }
}
