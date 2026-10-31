import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeStateTimeline from "../../../Models/DatabaseModels/AlertEpisodeStateTimeline";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeStateTimeline from "../../../Models/DatabaseModels/IncidentEpisodeStateTimeline";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import UserOnCallLog from "../../../Models/DatabaseModels/UserOnCallLog";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import {
  getOnCallAcknowledgementTimeoutInMinutes,
  hasOnCallPagesAgainLeft,
  isOnCallAcknowledgementTimeoutDue,
  isOnCallPageAgainRun,
} from "../../../Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout";
import { OnCallPageRecordType } from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import UserNotificationExecutionStatus from "../../../Types/UserNotification/UserNotificationExecutionStatus";
import AcknowledgedStateUtil from "../../../Utils/AcknowledgedState";
import ResolvedStateUtil, {
  ResolvedStateTimelineRow,
} from "../../../Utils/ResolvedState";
import { StateListType } from "../../../Utils/StateOrder";
import AlertEpisodeService from "../../Services/AlertEpisodeService";
import AlertEpisodeStateTimelineService from "../../Services/AlertEpisodeStateTimelineService";
import AlertService from "../../Services/AlertService";
import AlertStateService from "../../Services/AlertStateService";
import AlertStateTimelineService from "../../Services/AlertStateTimelineService";
import IncidentEpisodeService from "../../Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "../../Services/IncidentEpisodeStateTimelineService";
import IncidentService from "../../Services/IncidentService";
import IncidentStateService from "../../Services/IncidentStateService";
import IncidentStateTimelineService from "../../Services/IncidentStateTimelineService";
import OnCallDutyPolicyExecutionLogService from "../../Services/OnCallDutyPolicyExecutionLogService";
import UserOnCallLogService from "../../Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../Services/UserOnCallLogTimelineService";
import OnCallPersonPageAnswer from "./OnCallPersonPageAnswer";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * THE ACKNOWLEDGEMENT TIMEOUT, ON THE SERVER: THE CLOCK, AND PAGING AGAIN.
 *
 * What it is for, and every decision about it, is in
 * Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout. This is the one place
 * that does it.
 *
 * THE CLOCK. A policy whose acknowledgement timeout is on keeps one clock
 * for each record it paged about, on its LATEST run for that record
 * (OnCallDutyPolicyExecutionLog.acknowledgementTimeoutStartedAt) - so there
 * is one per record and policy, whatever the record's runs, and a page
 * again simply becomes the run that holds it. It starts:
 *
 *   - when the record moves into a state that counts as acknowledged from
 *     one that does not (onRecordStateChanged, which every state timeline
 *     calls): from the Dashboard, the mobile app, Slack or Microsoft Teams,
 *     the API, a workflow, or an answered page, which acknowledges the
 *     record that way;
 *   - when a page of the policy's latest run for the record is
 *     acknowledged (onPageAcknowledged): the way a page again is answered,
 *     since its record was acknowledged all along. A late answer to an
 *     older run's page starts nothing: that page is no longer the policy's
 *     word on the record.
 *
 * Moving on within the acknowledged states ("Acknowledged" to
 * "Investigating") is no new acknowledgement and leaves the clock alone. A
 * resolve stops every clock of the record.
 *
 * PAGING AGAIN. Every minute the worker
 * (OnCallDutyPolicyExecutionLog:PageAgainAfterAcknowledgementTimeout) reads
 * every running clock, through a partial index of them, and for each
 * (pageAgainIfDue), with the policy and the record as they are NOW:
 *
 *   - the policy archived or gone, or its timeout turned off: the clock
 *     stops;
 *   - not run out yet - by the policy's timeout today, so a changed number
 *     of minutes applies to a clock already running: nothing;
 *   - the record gone, resolved, or no longer acknowledged: the clock
 *     stops;
 *   - the policy paged again about the record as often as it may: the clock
 *     stops;
 *   - otherwise the clock is CLAIMED - stopped with one atomic
 *     compare-and-set of the moment it read - and whoever wins pages again
 *     (OnCallDutyPolicyExecutionLogService.startPageAgain). Two ticks, or
 *     two worker replicas, page again once; a clock started again by an
 *     acknowledgement in the same moment is left to run.
 *
 * Every entry point is best effort and never throws: a clock that could not
 * be started is logged, and acknowledging, a state change and the worker's
 * other runs go on.
 */

export type OnCallTimeoutRecordKind =
  | "incident"
  | "alert"
  | "incident episode"
  | "alert episode";

// The column of a run that names a record of each kind.
type RunRecordColumn =
  | "triggeredByIncidentId"
  | "triggeredByAlertId"
  | "triggeredByIncidentEpisodeId"
  | "triggeredByAlertEpisodeId";

// A record, as the clock reads it: its project and current state.
interface TimeoutRecord {
  projectId: ObjectID;
  stateId: ObjectID | null;
}

// A row of a record's state timeline: what it moved into, when, and who.
interface TimeoutTimelineRow extends ResolvedStateTimelineRow {
  createdByUserId?: ObjectID | null | undefined;
}

// One kind of record, as the clock reads it.
interface TimeoutRecordAccess {
  kind: OnCallTimeoutRecordKind;
  runColumn: RunRecordColumn;
  list: StateListType.IncidentState | StateListType.AlertState;
  readRecord: (recordId: ObjectID) => Promise<TimeoutRecord | null>;
  readStates: (projectId: ObjectID) => Promise<Array<unknown>>;
  readTimeline: (recordId: ObjectID) => Promise<Array<TimeoutTimelineRow>>;
}

// How many rows of a record's state timeline are read to find who acknowledged it.
const TIMELINE_ROWS_READ: number = 100;

const readIncidentStates: (
  projectId: ObjectID,
) => Promise<Array<unknown>> = async (
  projectId: ObjectID,
): Promise<Array<unknown>> => {
  return await IncidentStateService.getAllIncidentStates({
    projectId: projectId,
    props: { isRoot: true },
  });
};

const readAlertStates: (
  projectId: ObjectID,
) => Promise<Array<unknown>> = async (
  projectId: ObjectID,
): Promise<Array<unknown>> => {
  return await AlertStateService.getAllAlertStates({
    projectId: projectId,
    props: { isRoot: true },
  });
};

const INCIDENT: TimeoutRecordAccess = {
  kind: "incident",
  runColumn: "triggeredByIncidentId",
  list: StateListType.IncidentState,
  readRecord: async (recordId: ObjectID): Promise<TimeoutRecord | null> => {
    const incident: Incident | null = await IncidentService.findOneById({
      id: recordId,
      select: { projectId: true, currentIncidentStateId: true },
      props: { isRoot: true },
    });

    return incident?.projectId
      ? {
          projectId: incident.projectId,
          stateId: incident.currentIncidentStateId || null,
        }
      : null;
  },
  readStates: readIncidentStates,
  readTimeline: async (
    recordId: ObjectID,
  ): Promise<Array<TimeoutTimelineRow>> => {
    const rows: Array<IncidentStateTimeline> =
      await IncidentStateTimelineService.findBy({
        query: { incidentId: recordId },
        select: {
          incidentStateId: true,
          startsAt: true,
          createdByUserId: true,
        },
        sort: { startsAt: SortOrder.Descending },
        skip: 0,
        limit: TIMELINE_ROWS_READ,
        props: { isRoot: true },
      });

    return rows.map((row: IncidentStateTimeline): TimeoutTimelineRow => {
      return {
        stateId: row.incidentStateId,
        startsAt: row.startsAt,
        createdByUserId: row.createdByUserId,
      };
    });
  },
};

const ALERT: TimeoutRecordAccess = {
  kind: "alert",
  runColumn: "triggeredByAlertId",
  list: StateListType.AlertState,
  readRecord: async (recordId: ObjectID): Promise<TimeoutRecord | null> => {
    const alert: Alert | null = await AlertService.findOneById({
      id: recordId,
      select: { projectId: true, currentAlertStateId: true },
      props: { isRoot: true },
    });

    return alert?.projectId
      ? {
          projectId: alert.projectId,
          stateId: alert.currentAlertStateId || null,
        }
      : null;
  },
  readStates: readAlertStates,
  readTimeline: async (
    recordId: ObjectID,
  ): Promise<Array<TimeoutTimelineRow>> => {
    const rows: Array<AlertStateTimeline> =
      await AlertStateTimelineService.findBy({
        query: { alertId: recordId },
        select: { alertStateId: true, startsAt: true, createdByUserId: true },
        sort: { startsAt: SortOrder.Descending },
        skip: 0,
        limit: TIMELINE_ROWS_READ,
        props: { isRoot: true },
      });

    return rows.map((row: AlertStateTimeline): TimeoutTimelineRow => {
      return {
        stateId: row.alertStateId,
        startsAt: row.startsAt,
        createdByUserId: row.createdByUserId,
      };
    });
  },
};

const INCIDENT_EPISODE: TimeoutRecordAccess = {
  kind: "incident episode",
  runColumn: "triggeredByIncidentEpisodeId",
  list: StateListType.IncidentState,
  readRecord: async (recordId: ObjectID): Promise<TimeoutRecord | null> => {
    const episode: IncidentEpisode | null =
      await IncidentEpisodeService.findOneById({
        id: recordId,
        select: { projectId: true, currentIncidentStateId: true },
        props: { isRoot: true },
      });

    return episode?.projectId
      ? {
          projectId: episode.projectId,
          stateId: episode.currentIncidentStateId || null,
        }
      : null;
  },
  readStates: readIncidentStates,
  readTimeline: async (
    recordId: ObjectID,
  ): Promise<Array<TimeoutTimelineRow>> => {
    const rows: Array<IncidentEpisodeStateTimeline> =
      await IncidentEpisodeStateTimelineService.findBy({
        query: { incidentEpisodeId: recordId },
        select: {
          incidentStateId: true,
          startsAt: true,
          createdByUserId: true,
        },
        sort: { startsAt: SortOrder.Descending },
        skip: 0,
        limit: TIMELINE_ROWS_READ,
        props: { isRoot: true },
      });

    return rows.map((row: IncidentEpisodeStateTimeline): TimeoutTimelineRow => {
      return {
        stateId: row.incidentStateId,
        startsAt: row.startsAt,
        createdByUserId: row.createdByUserId,
      };
    });
  },
};

const ALERT_EPISODE: TimeoutRecordAccess = {
  kind: "alert episode",
  runColumn: "triggeredByAlertEpisodeId",
  list: StateListType.AlertState,
  readRecord: async (recordId: ObjectID): Promise<TimeoutRecord | null> => {
    const episode: AlertEpisode | null = await AlertEpisodeService.findOneById({
      id: recordId,
      select: { projectId: true, currentAlertStateId: true },
      props: { isRoot: true },
    });

    return episode?.projectId
      ? {
          projectId: episode.projectId,
          stateId: episode.currentAlertStateId || null,
        }
      : null;
  },
  readStates: readAlertStates,
  readTimeline: async (
    recordId: ObjectID,
  ): Promise<Array<TimeoutTimelineRow>> => {
    const rows: Array<AlertEpisodeStateTimeline> =
      await AlertEpisodeStateTimelineService.findBy({
        query: { alertEpisodeId: recordId },
        select: { alertStateId: true, startsAt: true, createdByUserId: true },
        sort: { startsAt: SortOrder.Descending },
        skip: 0,
        limit: TIMELINE_ROWS_READ,
        props: { isRoot: true },
      });

    return rows.map((row: AlertEpisodeStateTimeline): TimeoutTimelineRow => {
      return {
        stateId: row.alertStateId,
        startsAt: row.startsAt,
        createdByUserId: row.createdByUserId,
      };
    });
  },
};

const RECORD_ACCESS: Record<OnCallTimeoutRecordKind, TimeoutRecordAccess> = {
  incident: INCIDENT,
  alert: ALERT,
  "incident episode": INCIDENT_EPISODE,
  "alert episode": ALERT_EPISODE,
};

// A record's type in a page's route, as the clock names its kind.
const RECORD_KIND_OF_PAGE: Record<
  OnCallPageRecordType,
  OnCallTimeoutRecordKind
> = {
  [OnCallPageRecordType.Incident]: "incident",
  [OnCallPageRecordType.Alert]: "alert",
  [OnCallPageRecordType.IncidentEpisode]: "incident episode",
  [OnCallPageRecordType.AlertEpisode]: "alert episode",
};

// The statuses of a person's page still going out to them.
const OPEN_PAGE_STATUSES: Array<UserNotificationExecutionStatus> = [
  UserNotificationExecutionStatus.Scheduled,
  UserNotificationExecutionStatus.Started,
  UserNotificationExecutionStatus.Executing,
];

// Where a record stands, for the clock.
export interface OnCallTimeoutRecordState {
  // In a state that counts as acknowledged - resolved ones included.
  isAcknowledged: boolean;
  isResolved: boolean;
}

// Why a clock stopped without paging again.
export enum OnCallAcknowledgementTimeoutStop {
  PolicyGone = "PolicyGone",
  PolicyArchived = "PolicyArchived",
  TimeoutOff = "TimeoutOff",
  RecordGone = "RecordGone",
  RecordResolved = "RecordResolved",
  RecordNotAcknowledged = "RecordNotAcknowledged",
  NoPagesAgainLeft = "NoPagesAgainLeft",
}

// What the worker did with one running clock.
export enum OnCallPageAgainOutcome {
  // The clock has not run out yet.
  NotDue = "NotDue",
  // The clock stopped without paging again: `stoppedBecause` says why.
  Stopped = "Stopped",
  // Another tick stopped it first, or a new acknowledgement started it again.
  TakenElsewhere = "TakenElsewhere",
  // The policy paged again: `pageAgainRunId` is the new run.
  PagedAgain = "PagedAgain",
}

export interface OnCallPageAgainResult {
  runId: ObjectID;
  outcome: OnCallPageAgainOutcome;
  stoppedBecause?: OnCallAcknowledgementTimeoutStop | undefined;
  pageAgainRunId?: ObjectID | undefined;
  pageAgainNumber?: number | undefined;
}

// What the worker reads of each run whose clock runs.
export const CLOCK_RUN_SELECT: Select<OnCallDutyPolicyExecutionLog> = {
  _id: true,
  projectId: true,
  onCallDutyPolicyId: true,
  acknowledgementTimeoutStartedAt: true,
  pageAgainNumber: true,
  acknowledgedByUserId: true,
  lastExecutedEscalationRuleId: true,
  userNotificationEventType: true,
  triggeredByIncidentId: true,
  triggeredByAlertId: true,
  triggeredByAlertEpisodeId: true,
  triggeredByIncidentEpisodeId: true,
  onCallDutyPolicy: {
    _id: true,
    isArchived: true,
    acknowledgementTimeoutInMinutes: true,
  },
};

// A policy's run for a record, as the clock compares them.
const PAIR_RUN_SELECT: Select<OnCallDutyPolicyExecutionLog> = {
  _id: true,
  createdAt: true,
  pageAgainNumber: true,
  acknowledgementTimeoutStartedAt: true,
};

export default class OnCallAcknowledgementTimeout {
  // The kind of record a run pages about, and its id; null for none.
  public static getRunRecord(run: {
    triggeredByIncidentId?: ObjectID | undefined | null;
    triggeredByAlertId?: ObjectID | undefined | null;
    triggeredByAlertEpisodeId?: ObjectID | undefined | null;
    triggeredByIncidentEpisodeId?: ObjectID | undefined | null;
  }): { kind: OnCallTimeoutRecordKind; recordId: ObjectID } | null {
    if (run.triggeredByIncidentId) {
      return { kind: "incident", recordId: run.triggeredByIncidentId };
    }

    if (run.triggeredByAlertId) {
      return { kind: "alert", recordId: run.triggeredByAlertId };
    }

    if (run.triggeredByIncidentEpisodeId) {
      return {
        kind: "incident episode",
        recordId: run.triggeredByIncidentEpisodeId,
      };
    }

    if (run.triggeredByAlertEpisodeId) {
      return { kind: "alert episode", recordId: run.triggeredByAlertEpisodeId };
    }

    return null;
  }

  /*
   * Where a record stands - acknowledged, resolved - by the one rule
   * (Common/Utils/AcknowledgedState, ResolvedState). Null when it is gone.
   */
  @CaptureSpan()
  public static async readRecordState(data: {
    kind: OnCallTimeoutRecordKind;
    recordId: ObjectID;
  }): Promise<OnCallTimeoutRecordState | null> {
    const access: TimeoutRecordAccess = RECORD_ACCESS[data.kind];
    const record: TimeoutRecord | null = await access.readRecord(data.recordId);

    if (!record) {
      return null;
    }

    const states: Array<unknown> = await access.readStates(record.projectId);

    return {
      isAcknowledged: AcknowledgedStateUtil.isAcknowledged({
        list: access.list,
        states: states,
        stateId: record.stateId,
      }),
      isResolved: ResolvedStateUtil.isResolved({
        list: access.list,
        states: states,
        stateId: record.stateId,
      }),
    };
  }

  /*
   * A RECORD'S STATE CHANGED: every state timeline asks this once the
   * change is saved, for the record's current state.
   *
   *   - Resolved: every clock of the record stops - nothing is left to page
   *     again about.
   *   - Acknowledged, from a state that was not: a new acknowledgement. The
   *     clock of every policy that paged about the record and pages again
   *     after an acknowledgement starts now, on the policy's latest run for
   *     the record.
   *   - Anything else - moving on within the acknowledged states, say -
   *     leaves the clocks alone.
   *
   * An incident's or an alert's change is handed on to the pages people
   * asked for, too (OnCallPersonPageAnswer): its author, paged about it by
   * one, answers their page by acknowledging it. Here, as the one hook every
   * state timeline calls, with the states it reads anyway.
   *
   * Never throws: a clock that could not start is logged, and the state
   * change stands.
   */
  @CaptureSpan()
  public static async onRecordStateChanged(data: {
    kind: OnCallTimeoutRecordKind;
    recordId: ObjectID;
    projectId: ObjectID;
    // The record's state now, and the state it moved from (none for its first).
    stateId: ObjectID;
    previousStateId?: ObjectID | null | undefined;
    // Who changed it; none for a change OneUptime made on its own.
    changedByUserId?: ObjectID | null | undefined;
  }): Promise<void> {
    try {
      const access: TimeoutRecordAccess = RECORD_ACCESS[data.kind];
      const states: Array<unknown> = await access.readStates(data.projectId);

      const isResolved: boolean = ResolvedStateUtil.isResolved({
        list: access.list,
        states: states,
        stateId: data.stateId,
      });

      if (data.kind === "incident" || data.kind === "alert") {
        await OnCallPersonPageAnswer.onRecordStateChanged({
          kind: data.kind,
          recordId: data.recordId,
          projectId: data.projectId,
          changedByUserId: data.changedByUserId,
          isAcknowledged: AcknowledgedStateUtil.isAcknowledged({
            list: access.list,
            states: states,
            stateId: data.stateId,
          }),
          isResolved: isResolved,
        });
      }

      if (isResolved) {
        await this.stopEveryClockOfRecord({
          access: access,
          recordId: data.recordId,
        });

        return;
      }

      const isAcknowledged: boolean = AcknowledgedStateUtil.isAcknowledged({
        list: access.list,
        states: states,
        stateId: data.stateId,
      });

      const wasAcknowledged: boolean = data.previousStateId
        ? AcknowledgedStateUtil.isAcknowledged({
            list: access.list,
            states: states,
            stateId: data.previousStateId,
          })
        : false;

      if (!isAcknowledged || wasAcknowledged) {
        return;
      }

      await this.startClocksOfRecord({
        access: access,
        recordId: data.recordId,
        startedAt: OneUptimeDate.getCurrentDate(),
      });
    } catch (err) {
      logger.error(
        `Could not start or stop the acknowledgement timeout of ${data.kind} ${data.recordId.toString()} after its state changed.`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
      logger.error(err as Error);
    }
  }

  /*
   * A PAGE OF A RUN WAS ACKNOWLEDGED (UserOnCallLogTimelineService), once
   * the record it pages about is acknowledged too: a new acknowledgement.
   * When the run is its policy's latest for the record, and the policy pages
   * again after an acknowledgement, the clock starts again at
   * `acknowledgedAt` - how a page again is answered. Never throws.
   */
  @CaptureSpan()
  public static async onPageAcknowledged(data: {
    executionLogId: ObjectID;
    acknowledgedAt: Date;
  }): Promise<void> {
    try {
      const run: OnCallDutyPolicyExecutionLog | null =
        await OnCallDutyPolicyExecutionLogService.findOneById({
          id: data.executionLogId,
          select: {
            _id: true,
            onCallDutyPolicyId: true,
            triggeredByIncidentId: true,
            triggeredByAlertId: true,
            triggeredByAlertEpisodeId: true,
            triggeredByIncidentEpisodeId: true,
            onCallDutyPolicy: {
              _id: true,
              isArchived: true,
              acknowledgementTimeoutInMinutes: true,
            },
          },
          props: { isRoot: true },
        });

      const record: {
        kind: OnCallTimeoutRecordKind;
        recordId: ObjectID;
      } | null = run ? this.getRunRecord(run) : null;

      if (
        !run ||
        !run.onCallDutyPolicyId ||
        !record ||
        !this.doesPolicyPageAgain(run)
      ) {
        return;
      }

      const state: OnCallTimeoutRecordState | null =
        await this.readRecordState(record);

      if (!state || !state.isAcknowledged || state.isResolved) {
        return;
      }

      await this.startClock({
        access: RECORD_ACCESS[record.kind],
        recordId: record.recordId,
        onCallDutyPolicyId: run.onCallDutyPolicyId,
        startedAt: data.acknowledgedAt,
        onlyOnRunId: run.id!,
      });
    } catch (err) {
      logger.error(
        `Could not start the acknowledgement timeout again after a page of on-call execution log ${data.executionLogId.toString()} was acknowledged.`,
      );
      logger.error(err as Error);
    }
  }

  /*
   * ONE RUN OF THE WORKER: every running clock, each paged again about when
   * it has run out (pageAgainIfDue). One clock that fails is logged and the
   * others go on. Never throws.
   */
  @CaptureSpan()
  public static async run(
    now?: Date | undefined,
  ): Promise<Array<OnCallPageAgainResult>> {
    const at: Date = now || OneUptimeDate.getCurrentDate();
    const results: Array<OnCallPageAgainResult> = [];

    let runs: Array<OnCallDutyPolicyExecutionLog> = [];

    try {
      runs = await OnCallDutyPolicyExecutionLogService.findAllBy({
        query: {
          acknowledgementTimeoutStartedAt: QueryHelper.notNull(),
        },
        select: CLOCK_RUN_SELECT,
        props: { isRoot: true },
      });
    } catch (err) {
      logger.error(
        "Could not read the running acknowledgement timeouts; trying again in a minute.",
      );
      logger.error(err as Error);
      return results;
    }

    for (const run of runs) {
      try {
        results.push(await this.pageAgainIfDue({ run: run, now: at }));
      } catch (err) {
        logger.error(
          `Could not page again for on-call execution log ${run.id?.toString()}; its clock runs on.`,
          { projectId: run.projectId?.toString() } as LogAttributes,
        );
        logger.error(err as Error);
      }
    }

    return results;
  }

  /*
   * One running clock, at `now` (see the header): stops it, leaves it, or
   * pages again. `run` is the run as the worker read it (CLOCK_RUN_SELECT).
   */
  @CaptureSpan()
  public static async pageAgainIfDue(data: {
    run: OnCallDutyPolicyExecutionLog;
    now: Date;
  }): Promise<OnCallPageAgainResult> {
    const run: OnCallDutyPolicyExecutionLog = data.run;
    const runId: ObjectID = run.id!;
    const startedAt: Date | undefined = run.acknowledgementTimeoutStartedAt
      ? OneUptimeDate.fromString(run.acknowledgementTimeoutStartedAt)
      : undefined;

    if (!startedAt) {
      return { runId: runId, outcome: OnCallPageAgainOutcome.NotDue };
    }

    // The policy as it is now.
    if (!run.onCallDutyPolicyId || !run.onCallDutyPolicy) {
      return await this.stop({
        run: run,
        startedAt: startedAt,
        because: OnCallAcknowledgementTimeoutStop.PolicyGone,
      });
    }

    if (run.onCallDutyPolicy.isArchived === true) {
      return await this.stop({
        run: run,
        startedAt: startedAt,
        because: OnCallAcknowledgementTimeoutStop.PolicyArchived,
      });
    }

    const minutes: number | null = getOnCallAcknowledgementTimeoutInMinutes(
      run.onCallDutyPolicy,
    );

    if (minutes === null) {
      return await this.stop({
        run: run,
        startedAt: startedAt,
        because: OnCallAcknowledgementTimeoutStop.TimeoutOff,
      });
    }

    if (
      !isOnCallAcknowledgementTimeoutDue({
        startedAt: startedAt,
        minutes: minutes,
        now: data.now,
      })
    ) {
      return { runId: runId, outcome: OnCallPageAgainOutcome.NotDue };
    }

    // The record as it is now.
    const record: {
      kind: OnCallTimeoutRecordKind;
      recordId: ObjectID;
    } | null = this.getRunRecord(run);

    const state: OnCallTimeoutRecordState | null = record
      ? await this.readRecordState(record)
      : null;

    if (!record || !state) {
      return await this.stop({
        run: run,
        startedAt: startedAt,
        because: OnCallAcknowledgementTimeoutStop.RecordGone,
      });
    }

    if (state.isResolved) {
      return await this.stop({
        run: run,
        startedAt: startedAt,
        because: OnCallAcknowledgementTimeoutStop.RecordResolved,
      });
    }

    if (!state.isAcknowledged) {
      return await this.stop({
        run: run,
        startedAt: startedAt,
        because: OnCallAcknowledgementTimeoutStop.RecordNotAcknowledged,
      });
    }

    const pagesAgainSoFar: number = await this.countPagesAgain({
      access: RECORD_ACCESS[record.kind],
      recordId: record.recordId,
      onCallDutyPolicyId: run.onCallDutyPolicyId,
    });

    if (!hasOnCallPagesAgainLeft(pagesAgainSoFar)) {
      return await this.stop({
        run: run,
        startedAt: startedAt,
        because: OnCallAcknowledgementTimeoutStop.NoPagesAgainLeft,
      });
    }

    /*
     * Claimed: the clock is stopped as it was read. Whoever stops it pages
     * again; a tick that lost, or a clock an acknowledgement just started
     * again, does nothing.
     */
    const claimed: boolean =
      await OnCallDutyPolicyExecutionLogService.stopAcknowledgementTimeoutClock(
        {
          executionLogId: runId,
          expectedStartedAt: startedAt,
        },
      );

    if (!claimed) {
      return { runId: runId, outcome: OnCallPageAgainOutcome.TakenElsewhere };
    }

    const pageAgainNumber: number = pagesAgainSoFar + 1;

    const acknowledgedByUserId: ObjectID | null =
      run.acknowledgedByUserId ||
      (await this.readAcknowledger({
        access: RECORD_ACCESS[record.kind],
        recordId: record.recordId,
      }));

    logger.debug(
      `The ${record.kind} ${record.recordId.toString()} is still not resolved ${minutes} minutes after it was acknowledged: on-call execution log ${runId.toString()} pages again (${pageAgainNumber}).`,
      { projectId: run.projectId?.toString() } as LogAttributes,
    );

    const pageAgainRunId: ObjectID | null =
      await OnCallDutyPolicyExecutionLogService.startPageAgain({
        projectId: run.projectId!,
        onCallDutyPolicyId: run.onCallDutyPolicyId,
        triggeredByIncidentId: run.triggeredByIncidentId,
        triggeredByAlertId: run.triggeredByAlertId,
        triggeredByAlertEpisodeId: run.triggeredByAlertEpisodeId,
        triggeredByIncidentEpisodeId: run.triggeredByIncidentEpisodeId,
        userNotificationEventType: run.userNotificationEventType!,
        pageAgainNumber: pageAgainNumber,
        minutes: minutes,
        recordKind: record.kind,
        startAtRuleId: run.lastExecutedEscalationRuleId || undefined,
        acknowledgedByUserId: acknowledgedByUserId || undefined,
      });

    return {
      runId: runId,
      outcome: OnCallPageAgainOutcome.PagedAgain,
      pageAgainRunId: pageAgainRunId || undefined,
      pageAgainNumber: pageAgainNumber,
    };
  }

  /*
   * Whether a run is over for its people: the run is a page again
   * (isOnCallPageAgainRun) and somebody acknowledged it, or its record is
   * resolved - what ends a page again, since its record was acknowledged
   * all along. A page a person asked for (OnCallPersonPage) ends the same
   * way: somebody it paged answered it, or its record is resolved. Any
   * other run is over once its record is acknowledged, and is not asked
   * here. Returns why it is over - "this page again is acknowledged", "this
   * page is acknowledged", "incident is resolved" - or null.
   */
  @CaptureSpan()
  public static async getPageAgainOverReason(data: {
    run: {
      pageAgainNumber?: number | null | undefined;
      acknowledgedAt?: Date | null | undefined;
    };
    kind: OnCallTimeoutRecordKind;
    recordId: ObjectID;
  }): Promise<string | null> {
    if (data.run.acknowledgedAt) {
      return isOnCallPageAgainRun(data.run)
        ? "this page again is acknowledged"
        : "this page is acknowledged";
    }

    const state: OnCallTimeoutRecordState | null = await this.readRecordState({
      kind: data.kind,
      recordId: data.recordId,
    });

    if (!state) {
      return `${data.kind} is deleted`;
    }

    return state.isResolved ? `${data.kind} is resolved` : null;
  }

  /*
   * ACKNOWLEDGES A PERSON'S PAGES AGAIN ABOUT A RECORD - from the Dashboard,
   * signed in as them (OnCallPagePassOnAPI). A page again's record was
   * acknowledged all along, so the record's own Acknowledge is not offered;
   * the person acknowledges their page instead, as its link, a call's 1 or
   * a text would (UserOnCallLogTimelineService.acknowledgePage): their
   * notifications still due stop, the page again is answered and ends, and
   * the clock starts again.
   *
   * Only the person's own pages that a page again sent and that are still
   * going out to them; nothing once the record is resolved (the page again
   * is over). Returns how many it acknowledged: none is an answer too - not
   * paged again, or answered already.
   */
  @CaptureSpan()
  public static async acknowledgePagesAgainForRecord(data: {
    userId: ObjectID;
    projectId: ObjectID;
    recordType: OnCallPageRecordType;
    recordId: ObjectID;
  }): Promise<number> {
    const kind: OnCallTimeoutRecordKind = RECORD_KIND_OF_PAGE[data.recordType];
    const access: TimeoutRecordAccess = RECORD_ACCESS[kind];

    const logs: Array<UserOnCallLog> = await UserOnCallLogService.findBy({
      query: {
        projectId: data.projectId,
        userId: data.userId,
        status: QueryHelper.any(OPEN_PAGE_STATUSES),
        [access.runColumn]: data.recordId,
      },
      select: {
        _id: true,
        userId: true,
        onCallDutyPolicyExecutionLogId: true,
        onCallDutyPolicyExecutionLogTimelineId: true,
        triggeredByIncidentId: true,
        triggeredByAlertId: true,
        triggeredByAlertEpisodeId: true,
        triggeredByIncidentEpisodeId: true,
        onCallDutyPolicyExecutionLog: {
          pageAgainNumber: true,
          acknowledgedAt: true,
        },
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });

    const pagesAgain: Array<UserOnCallLog> = logs.filter(
      (log: UserOnCallLog): boolean => {
        return (
          isOnCallPageAgainRun(log.onCallDutyPolicyExecutionLog) &&
          !log.onCallDutyPolicyExecutionLog?.acknowledgedAt
        );
      },
    );

    if (pagesAgain.length === 0) {
      return 0;
    }

    const state: OnCallTimeoutRecordState | null = await this.readRecordState({
      kind: kind,
      recordId: data.recordId,
    });

    // Resolved, or gone: the page again is over, with nothing to answer.
    if (!state || state.isResolved) {
      return 0;
    }

    const acknowledgedAt: Date = OneUptimeDate.getCurrentDate();

    for (const log of pagesAgain) {
      await UserOnCallLogTimelineService.acknowledgePage({
        userOnCallLogId: log.id!,
        userId: data.userId,
        onCallDutyPolicyExecutionLogId: log.onCallDutyPolicyExecutionLogId,
        onCallDutyPolicyExecutionLogTimelineId:
          log.onCallDutyPolicyExecutionLogTimelineId,
        triggeredByIncidentId: log.triggeredByIncidentId,
        triggeredByAlertId: log.triggeredByAlertId,
        triggeredByAlertEpisodeId: log.triggeredByAlertEpisodeId,
        triggeredByIncidentEpisodeId: log.triggeredByIncidentEpisodeId,
        acknowledgedAt: acknowledgedAt,
      });
    }

    return pagesAgain.length;
  }

  // Whether a run's policy pages again after an acknowledgement, as read with it.
  private static doesPolicyPageAgain(
    run: OnCallDutyPolicyExecutionLog,
  ): boolean {
    return Boolean(
      run.onCallDutyPolicy &&
        run.onCallDutyPolicy.isArchived !== true &&
        getOnCallAcknowledgementTimeoutInMinutes(run.onCallDutyPolicy) !== null,
    );
  }

  // Stops a clock that has nothing left to count for, as it was read.
  private static async stop(data: {
    run: OnCallDutyPolicyExecutionLog;
    startedAt: Date;
    because: OnCallAcknowledgementTimeoutStop;
  }): Promise<OnCallPageAgainResult> {
    const stopped: boolean =
      await OnCallDutyPolicyExecutionLogService.stopAcknowledgementTimeoutClock(
        {
          executionLogId: data.run.id!,
          expectedStartedAt: data.startedAt,
        },
      );

    return stopped
      ? {
          runId: data.run.id!,
          outcome: OnCallPageAgainOutcome.Stopped,
          stoppedBecause: data.because,
        }
      : { runId: data.run.id!, outcome: OnCallPageAgainOutcome.TakenElsewhere };
  }

  /*
   * The clock of every policy that paged about a record and pages again
   * after an acknowledgement starts, each on the policy's latest run for it.
   */
  private static async startClocksOfRecord(data: {
    access: TimeoutRecordAccess;
    recordId: ObjectID;
    startedAt: Date;
  }): Promise<void> {
    const runs: Array<OnCallDutyPolicyExecutionLog> =
      await OnCallDutyPolicyExecutionLogService.findBy({
        query: {
          [data.access.runColumn]: data.recordId,
          onCallDutyPolicyId: QueryHelper.notNull(),
        },
        select: {
          _id: true,
          onCallDutyPolicyId: true,
          onCallDutyPolicy: {
            _id: true,
            isArchived: true,
            acknowledgementTimeoutInMinutes: true,
          },
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });

    const policyIds: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (const run of runs) {
      if (run.onCallDutyPolicyId && this.doesPolicyPageAgain(run)) {
        policyIds.set(
          run.onCallDutyPolicyId.toString().toLowerCase(),
          run.onCallDutyPolicyId,
        );
      }
    }

    for (const onCallDutyPolicyId of policyIds.values()) {
      await this.startClock({
        access: data.access,
        recordId: data.recordId,
        onCallDutyPolicyId: onCallDutyPolicyId,
        startedAt: data.startedAt,
      });
    }
  }

  /*
   * Starts one policy's clock for a record at `startedAt`, on the policy's
   * latest run for it - only when that is `onlyOnRunId`, when given - and
   * stops any other of its runs' clocks, so there is one. A policy that has
   * paged again as often as it may starts no clock.
   */
  private static async startClock(data: {
    access: TimeoutRecordAccess;
    recordId: ObjectID;
    onCallDutyPolicyId: ObjectID;
    startedAt: Date;
    onlyOnRunId?: ObjectID | undefined;
  }): Promise<void> {
    const runs: Array<OnCallDutyPolicyExecutionLog> =
      await this.readPolicyRunsForRecord(data);

    const latest: OnCallDutyPolicyExecutionLog | undefined = runs[0];

    if (!latest || !latest.id) {
      return;
    }

    if (
      data.onlyOnRunId &&
      latest.id.toString().toLowerCase() !==
        data.onlyOnRunId.toString().toLowerCase()
    ) {
      return;
    }

    if (!hasOnCallPagesAgainLeft(this.getPagesAgainSoFar(runs))) {
      return;
    }

    for (const run of runs.slice(1)) {
      if (run.id && run.acknowledgementTimeoutStartedAt) {
        await OnCallDutyPolicyExecutionLogService.stopAcknowledgementTimeoutClock(
          {
            executionLogId: run.id,
            expectedStartedAt: OneUptimeDate.fromString(
              run.acknowledgementTimeoutStartedAt,
            ),
          },
        );
      }
    }

    await OnCallDutyPolicyExecutionLogService.startAcknowledgementTimeoutClock({
      executionLogId: latest.id,
      startedAt: data.startedAt,
    });
  }

  // Every clock of a record stops: it is resolved.
  private static async stopEveryClockOfRecord(data: {
    access: TimeoutRecordAccess;
    recordId: ObjectID;
  }): Promise<void> {
    const runs: Array<OnCallDutyPolicyExecutionLog> =
      await OnCallDutyPolicyExecutionLogService.findBy({
        query: {
          [data.access.runColumn]: data.recordId,
          acknowledgementTimeoutStartedAt: QueryHelper.notNull(),
        },
        select: {
          _id: true,
          acknowledgementTimeoutStartedAt: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      });

    for (const run of runs) {
      if (run.id && run.acknowledgementTimeoutStartedAt) {
        await OnCallDutyPolicyExecutionLogService.stopAcknowledgementTimeoutClock(
          {
            executionLogId: run.id,
            expectedStartedAt: OneUptimeDate.fromString(
              run.acknowledgementTimeoutStartedAt,
            ),
          },
        );
      }
    }
  }

  // A policy's runs for a record, the latest first.
  private static async readPolicyRunsForRecord(data: {
    access: TimeoutRecordAccess;
    recordId: ObjectID;
    onCallDutyPolicyId: ObjectID;
  }): Promise<Array<OnCallDutyPolicyExecutionLog>> {
    return await OnCallDutyPolicyExecutionLogService.findBy({
      query: {
        [data.access.runColumn]: data.recordId,
        onCallDutyPolicyId: data.onCallDutyPolicyId,
      },
      select: PAIR_RUN_SELECT,
      sort: {
        createdAt: SortOrder.Descending,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });
  }

  // How many times a policy has paged again about a record: its latest page again's number.
  private static async countPagesAgain(data: {
    access: TimeoutRecordAccess;
    recordId: ObjectID;
    onCallDutyPolicyId: ObjectID;
  }): Promise<number> {
    return this.getPagesAgainSoFar(await this.readPolicyRunsForRecord(data));
  }

  private static getPagesAgainSoFar(
    runs: Array<OnCallDutyPolicyExecutionLog>,
  ): number {
    let count: number = 0;

    for (const run of runs) {
      if (isOnCallPageAgainRun(run)) {
        count = Math.max(count, Number(run.pageAgainNumber));
      }
    }

    return count;
  }

  /*
   * Who acknowledged a record last, by its state timeline: who moved it
   * into a state that counts as acknowledged, from one that did not, the
   * latest time it did. Null when nobody did by name - an API key, a
   * workflow - or it cannot be read.
   */
  private static async readAcknowledger(data: {
    access: TimeoutRecordAccess;
    recordId: ObjectID;
  }): Promise<ObjectID | null> {
    try {
      const record: TimeoutRecord | null = await data.access.readRecord(
        data.recordId,
      );

      if (!record) {
        return null;
      }

      const [states, timeline]: [Array<unknown>, Array<TimeoutTimelineRow>] =
        await Promise.all([
          data.access.readStates(record.projectId),
          data.access.readTimeline(data.recordId),
        ]);

      const acknowledgements: Array<TimeoutTimelineRow> =
        AcknowledgedStateUtil.getAcknowledgementRows({
          list: data.access.list,
          states: states,
          timeline: timeline,
        });

      return (
        acknowledgements[acknowledgements.length - 1]?.createdByUserId || null
      );
    } catch (err) {
      logger.error(
        `Could not read who acknowledged ${data.access.kind} ${data.recordId.toString()}; paging again without them.`,
      );
      logger.error(err as Error);
      return null;
    }
  }
}
