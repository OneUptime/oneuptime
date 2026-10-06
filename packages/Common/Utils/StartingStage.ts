import ObjectID from "../Types/ObjectID";
import {
  StateListDefinition,
  StateListRow,
  getStateListReachedBuiltIn,
  toStateListRow,
} from "./StateOrder";

/*
 * HOW FAR ALONG A NEW INCIDENT, ALERT OR EPISODE STARTS - AND SO WHAT ITS
 * CREATE SETS OFF.
 *
 * A record normally starts in its project's created state, and its create
 * sets off everything that answers a live problem: its on-call policies page
 * people, a grouping rule may put it into an episode, runbook and
 * auto-remediation rules act on it, OneUptime AI investigates it, and a
 * workspace rule may open a channel for it in Slack or Microsoft Teams.
 *
 * A record can also be written down after the fact, in a later state: the
 * create forms' Initial State, an incident template's initial state, the
 * API, Terraform, a workflow. Then one rule holds for incidents, alerts and
 * both kinds of episode:
 *
 *   - It starts at or past the acknowledged state: somebody is on it
 *     already, so no on-call policy runs, and its feed says so. Everything
 *     else runs as for a live record.
 *   - It starts at or past the resolved state: it is over. On top of that,
 *     nothing responds to it - it is not grouped into an episode, no runbook
 *     or auto-remediation rule acts on it, OneUptime AI does not investigate
 *     it and no channel is opened for it - and an incident leaves its
 *     monitors and their monitoring alone and starts no SLA.
 *
 * Its owners still hear that it was created, its feed still records it, and
 * status page subscribers are still told when it is shown to them: a record
 * that is already over is still news.
 *
 * "At or past" is the comparison everything else makes on the project's
 * ordered state list (getStateListReachedBuiltIn): a state counts as
 * acknowledged when its place is at or below the acknowledged state's - as
 * on-call escalation reads it - and as resolved at or below the resolved
 * state's. A state of the project's own between the created and the
 * acknowledged state is still open: its record pages.
 */
export enum StartingStage {
  // The created state, or a state before the acknowledged one.
  Open = "Open",
  // At or past the acknowledged state, before the resolved one.
  Acknowledged = "Acknowledged",
  // At or past the resolved state.
  Resolved = "Resolved",
}

/*
 * What a create hook hands its success hook about where the record starts:
 * read once, before the record is written, and decided on after.
 */
export interface StartingStageCarryForward {
  startingStage: StartingStage;
}

const ACKNOWLEDGED_STATE_FLAG: string = "isAcknowledgedState";
const RESOLVED_STATE_FLAG: string = "isResolvedState";

const STARTING_STAGES: Array<string> = Object.values(StartingStage);

export default class StartingStageUtil {
  /*
   * The stage a record starts at in `stateId`, read off its project's states
   * (the models, or their JSON: id, place and the built-in flags). A state
   * carrying the resolved or acknowledged flag counts as that whatever its
   * place. A state the list does not hold is Open: the record then sets off
   * what one created in the created state does, as before this rule.
   */
  public static getStage(data: {
    definition: StateListDefinition;
    states: Array<unknown>;
    stateId: ObjectID | string;
  }): StartingStage {
    const rows: Array<StateListRow> = data.states.map(
      (state: unknown): StateListRow => {
        return toStateListRow(data.definition, state);
      },
    );

    const stateId: string = data.stateId.toString().toLowerCase();

    const row: StateListRow | undefined = rows.find(
      (candidate: StateListRow): boolean => {
        return candidate.id.toLowerCase() === stateId;
      },
    );

    if (!row) {
      return StartingStage.Open;
    }

    const reached: string | null = getStateListReachedBuiltIn(
      data.definition,
      rows,
      row,
    );

    if (
      reached === RESOLVED_STATE_FLAG ||
      row.flags.includes(RESOLVED_STATE_FLAG)
    ) {
      return StartingStage.Resolved;
    }

    if (
      reached === ACKNOWLEDGED_STATE_FLAG ||
      row.flags.includes(ACKNOWLEDGED_STATE_FLAG)
    ) {
      return StartingStage.Acknowledged;
    }

    return StartingStage.Open;
  }

  // Whether the record's on-call policies run: only one that starts open.
  public static pagesOnCall(stage: StartingStage): boolean {
    return stage === StartingStage.Open;
  }

  /*
   * Whether what answers a live problem runs for the record - grouping,
   * runbook and auto-remediation rules, an AI investigation, a workspace
   * channel, an incident's monitor status and SLA: for every record that
   * does not start resolved.
   */
  public static isOngoing(stage: StartingStage): boolean {
    return stage !== StartingStage.Resolved;
  }

  /*
   * The stage a create hook handed its success hook in the carry-forward
   * ({ startingStage }). Anything else - no carry-forward, as when a success
   * hook is called on its own - is Open: what a record created in the
   * created state sets off.
   */
  public static fromCarryForward(carryForward: unknown): StartingStage {
    if (carryForward && typeof carryForward === "object") {
      const stage: unknown = (carryForward as Record<string, unknown>)[
        "startingStage"
      ];

      if (typeof stage === "string" && STARTING_STAGES.includes(stage)) {
        return stage as StartingStage;
      }
    }

    return StartingStage.Open;
  }
}
