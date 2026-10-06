import ObjectID from "../Types/ObjectID";
import ResolvedStateUtil, { ResolvedStateList } from "./ResolvedState";
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
 *   - It starts acknowledged: somebody is on it already, so no on-call
 *     policy runs, its feed says so, and grouping may put it into an
 *     episode that is open but never opens or reopens one for it.
 *     Everything else runs as for a live record.
 *   - It starts resolved: it is over. On top of that, nothing responds to
 *     it - it is not grouped into an episode, no runbook or
 *     auto-remediation rule acts on it, OneUptime AI does not investigate it
 *     and no channel is opened for it - and an incident leaves its monitors
 *     and their monitoring alone and starts no SLA.
 *
 * Its owners still hear that it was created, its feed still records it, and
 * status page subscribers are still told when it is shown to them: a record
 * that is already over is still news.
 *
 * Which state counts as which is the comparison OneUptime makes on the
 * project's ordered state list (getStateListReachedBuiltIn), and what the
 * state settings pages show as "Counts as":
 *
 *   - Resolved: at or below the resolved state, or flagged resolved - the
 *     one rule every part of OneUptime reads (Common/Utils/ResolvedState):
 *     reminders, status pages, the Active lists, an incident's resolve and
 *     an episode's resolvedAt. A record that starts there has no later
 *     resolve to give its monitors back or close its SLA, so it takes
 *     neither, and an episode that starts there is resolved from the moment
 *     it exists.
 *   - Acknowledged: at or below the acknowledged state, or flagged
 *     acknowledged - as on-call escalation reads it to stop paging.
 *   - Open: the created state, and any state of the project's own above the
 *     acknowledged one: its record pages.
 */
export enum StartingStage {
  // The created state, or a state before the acknowledged one.
  Open = "Open",
  // At or past the acknowledged state, before the resolved one.
  Acknowledged = "Acknowledged",
  // At or past the resolved state.
  Resolved = "Resolved",
}

// Where a record starts, as one read of its project's states places it.
export interface StartingState {
  stage: StartingStage;
}

/*
 * What a create hook hands its success hook about where the record starts:
 * read once, before the record is written, and decided on after.
 */
export interface StartingStageCarryForward {
  startingStage: StartingStage;
}

/*
 * How the alert and incident grouping engines may group a record
 * (processAlert, processIncident). An episode a rule opens starts in the
 * created state and runs its own on-call policies, and one it reopens goes
 * back to the created state, live again, with its owners told so. Neither
 * fits a record somebody is already on: one that pages nobody
 * (StartingStageUtil.pagesOnCall) may only join an episode that is open.
 */
export interface GroupingOptions {
  // Unset, a rule may open or reopen an episode for the record, as always.
  mayOpenEpisode?: boolean | undefined;
}

const ACKNOWLEDGED_STATE_FLAG: string = "isAcknowledgedState";

const STARTING_STAGES: Array<string> = Object.values(StartingStage);

export default class StartingStageUtil {
  /*
   * Where a record starts in `stateId`, read off its project's states (the
   * models, or their JSON: id, place and the built-in flags). Null when
   * `stateId` is none of them - another project's state, or no state at
   * all - so one read of the project's states both places a state and tells
   * whether the project has it.
   */
  public static getStartingState(data: {
    definition: StateListDefinition;
    states: Array<unknown>;
    stateId: ObjectID | string;
  }): StartingState | null {
    const rows: Array<StateListRow> = data.states.map(
      (state: unknown): StateListRow => {
        return toStateListRow(data.definition, state);
      },
    );

    const stateId: string = data.stateId.toString().trim().toLowerCase();

    if (!stateId) {
      return null;
    }

    const row: StateListRow | undefined = rows.find(
      (candidate: StateListRow): boolean => {
        return candidate.id.toLowerCase() === stateId;
      },
    );

    if (!row) {
      return null;
    }

    // Resolved by the one rule every reader shares (ResolvedState).
    if (
      ResolvedStateUtil.isResolved({
        list: data.definition.type as ResolvedStateList,
        states: data.states,
        stateId: row.id,
      })
    ) {
      return { stage: StartingStage.Resolved };
    }

    const reached: string | null = getStateListReachedBuiltIn(
      data.definition,
      rows,
      row,
    );

    if (
      reached === ACKNOWLEDGED_STATE_FLAG ||
      row.flags.includes(ACKNOWLEDGED_STATE_FLAG)
    ) {
      return { stage: StartingStage.Acknowledged };
    }

    return { stage: StartingStage.Open };
  }

  // The stage alone (getStartingState): null for a state the list does not hold.
  public static getStage(data: {
    definition: StateListDefinition;
    states: Array<unknown>;
    stateId: ObjectID | string;
  }): StartingStage | null {
    return this.getStartingState(data)?.stage || null;
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
