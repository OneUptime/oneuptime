import UserOnCallLog from "../../../Models/DatabaseModels/UserOnCallLog";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import {
  OnCallObserverOpenPage,
  isOnCallObserverPage,
} from "../../../Types/OnCallDutyPolicy/OnCallObserverPage";
import { OnCallPageRecordType } from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import UserNotificationExecutionStatus from "../../../Types/UserNotification/UserNotificationExecutionStatus";
import UserOnCallLogService from "../../Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../Services/UserOnCallLogTimelineService";
import QueryHelper from "../../Types/Database/QueryHelper";
import CaptureSpan from "../Telemetry/CaptureSpan";
import OnCallAcknowledgementTimeout, {
  OnCallTimeoutRecordKind,
  OnCallTimeoutRecordState,
} from "./OnCallAcknowledgementTimeout";

/*
 * "I'VE SEEN IT" FROM THE MOBILE APP (OnCallObserverPage).
 *
 * Somebody paged as an observer about a record answers their page from the
 * record's screen in the On-Call app - the action under their push opens it
 * there, and so does the screen's own button - signed in as them
 * (OnCallPagePassOnAPI). Each page is answered the way its link, a call's 1
 * or a text answers it (UserOnCallLogTimelineService.acknowledgePage), which
 * for a run that pages as observers only says they have seen it: the record
 * is not acknowledged, nobody else's page stops, and nobody becomes its
 * Incident Commander.
 *
 * A page the person can still say they have seen is
 *
 *   - theirs, in the project they are signed in to, about the record;
 *   - of a run that pages as observers - a responder's page is never
 *     answered here;
 *   - not answered yet, by them or by anybody else the run paged: an
 *     observer's page goes on until one of its people answers it;
 *   - not escalated by them;
 *   - and about a record that is still open: once it is resolved, its
 *     observers' pages are over.
 *
 * Its notifications may all have gone out already - a push, then nothing -
 * and it is still theirs to answer, as its email's link is: what ends it is
 * an answer, or the record being resolved.
 */

type LogRecordColumn =
  | "triggeredByIncidentId"
  | "triggeredByAlertId"
  | "triggeredByIncidentEpisodeId"
  | "triggeredByAlertEpisodeId";

// Each record type in the route: how the clock names its kind, and its column.
const RECORD_OF_PAGE: Record<
  OnCallPageRecordType,
  { kind: OnCallTimeoutRecordKind; column: LogRecordColumn }
> = {
  [OnCallPageRecordType.Incident]: {
    kind: "incident",
    column: "triggeredByIncidentId",
  },
  [OnCallPageRecordType.Alert]: {
    kind: "alert",
    column: "triggeredByAlertId",
  },
  [OnCallPageRecordType.IncidentEpisode]: {
    kind: "incident episode",
    column: "triggeredByIncidentEpisodeId",
  },
  [OnCallPageRecordType.AlertEpisode]: {
    kind: "alert episode",
    column: "triggeredByAlertEpisodeId",
  },
};

export interface OnCallObserverPageSeenRequest {
  userId: ObjectID;
  projectId: ObjectID;
  recordType: OnCallPageRecordType;
  recordId: ObjectID;
}

export default class OnCallObserverPageSeen {
  /*
   * The person's observer pages about the record that they can still say
   * they have seen, one for each run, newest first.
   */
  @CaptureSpan()
  public static async getOpenPagesForRecord(
    data: OnCallObserverPageSeenRequest,
  ): Promise<Array<OnCallObserverOpenPage>> {
    const pages: Array<OnCallObserverOpenPage> = [];
    const runIds: Set<string> = new Set();

    for (const log of await this.readOpenPages(data)) {
      const runId: string = log.onCallDutyPolicyExecutionLogId!.toString();

      if (runIds.has(runId)) {
        continue;
      }

      runIds.add(runId);
      pages.push({
        executionLogId: runId,
        policyName: log.onCallDutyPolicy?.name?.toString().trim() || "",
      });
    }

    return pages;
  }

  /*
   * Says the person has seen each of them, and how many runs it answered:
   * none is an answer too.
   */
  @CaptureSpan()
  public static async markPagesSeenForRecord(
    data: OnCallObserverPageSeenRequest,
  ): Promise<number> {
    const logs: Array<UserOnCallLog> = await this.readOpenPages(data);

    if (logs.length === 0) {
      return 0;
    }

    const acknowledgedAt: Date = OneUptimeDate.getCurrentDate();
    const runIds: Set<string> = new Set();

    for (const log of logs) {
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

      runIds.add(log.onCallDutyPolicyExecutionLogId!.toString());
    }

    return runIds.size;
  }

  // The person's pages that the rule above leaves theirs to answer.
  private static async readOpenPages(
    data: OnCallObserverPageSeenRequest,
  ): Promise<Array<UserOnCallLog>> {
    const record: { kind: OnCallTimeoutRecordKind; column: LogRecordColumn } =
      RECORD_OF_PAGE[data.recordType];

    const logs: Array<UserOnCallLog> = await UserOnCallLogService.findBy({
      query: {
        projectId: data.projectId,
        userId: data.userId,
        [record.column]: data.recordId,
        acknowledgedAt: QueryHelper.isNull(),
      },
      select: {
        _id: true,
        userId: true,
        status: true,
        onCallDutyPolicyExecutionLogId: true,
        onCallDutyPolicyExecutionLogTimelineId: true,
        triggeredByIncidentId: true,
        triggeredByAlertId: true,
        triggeredByAlertEpisodeId: true,
        triggeredByIncidentEpisodeId: true,
        onCallDutyPolicy: {
          name: true,
        },
        onCallDutyPolicyExecutionLog: {
          isObserverPage: true,
          acknowledgedAt: true,
        },
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    const open: Array<UserOnCallLog> = logs.filter(
      (log: UserOnCallLog): boolean => {
        return (
          Boolean(log.id && log.onCallDutyPolicyExecutionLogId) &&
          !log.acknowledgedAt &&
          isOnCallObserverPage(log.onCallDutyPolicyExecutionLog) &&
          !log.onCallDutyPolicyExecutionLog?.acknowledgedAt &&
          log.status !== UserNotificationExecutionStatus.PassedOn
        );
      },
    );

    if (open.length === 0) {
      return [];
    }

    const state: OnCallTimeoutRecordState | null =
      await OnCallAcknowledgementTimeout.readRecordState({
        kind: record.kind,
        recordId: data.recordId,
      });

    // Resolved, or gone: the observers' pages are over.
    if (!state || state.isResolved) {
      return [];
    }

    return open;
  }
}
