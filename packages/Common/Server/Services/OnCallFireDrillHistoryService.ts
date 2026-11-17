import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BaseService from "./BaseService";
import MonitorService from "./MonitorService";
import OnCallDutyPolicyExecutionLogService from "./OnCallDutyPolicyExecutionLogService";
import OnCallTestPageService from "./OnCallTestPageService";
import Monitor from "../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicyExecutionLog from "../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../Types/ObjectID";
import {
  OnCallFireDrillFailureRecord,
  OnCallFireDrillRecord,
} from "../../Types/OnCallDutyPolicy/OnCallFireDrill";
import {
  OnCallTestPageRecordKind,
  isOnCallTestPage,
  isOnCallTestPageRecordKind,
} from "../../Types/OnCallDutyPolicy/OnCallTestPage";

/*
 * A MONITOR'S LAST FIRE DRILL (#9386, Types/OnCallDutyPolicy/OnCallFireDrill):
 * what its When this goes down card says of it after the drill's dialog is
 * closed - when it ran, who ran it, the failure it rehearsed, and what became
 * of each policy's test: acknowledged or not, by whom, by what and how fast.
 *
 * "Last" is the latest drill of the monitor, and only that: the one line
 * the card has room for. Every drill before it is still in each policy's
 * execution logs, where each test says it was part of a fire drill of the
 * monitor.
 *
 * Nothing is kept of a drill but its tests: each one, a run of its policy,
 * says which drill it is part of, the monitor and the failure
 * (OnCallDutyPolicyExecutionLog.testPageFireDrill*, written as the drill
 * starts them, OnCallFireDrillService). So a drill's results are read as
 * its tests are:
 *
 *   - by somebody who may read the monitor - as its card is read; a monitor
 *     they may not read is not found;
 *   - and every one of its tests, as they may read its policy's execution
 *     logs - its table's read, the policy's labels and owned scope counted.
 *     A drill with one test they may not read is not shown at all: its
 *     results would say all is well, or name a policy hidden from them.
 */
export class OnCallFireDrillHistoryService extends BaseService {
  public constructor() {
    super();
  }

  /*
   * The monitor's last drill as the reader may read it; null when it has
   * none, or none the reader may read all of. Throws when the reader may
   * not read the monitor.
   */
  @CaptureSpan()
  public async getLast(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<OnCallFireDrillRecord | null> {
    const monitor: Monitor | null = await MonitorService.findOneBy({
      query: {
        _id: data.monitorId.toString(),
        projectId: data.projectId,
      },
      select: {
        _id: true,
      },
      props: data.props,
    });

    if (!monitor) {
      throw new BadDataException("Monitor not found.");
    }

    // The newest test that names the monitor is its last drill's.
    const latest: OnCallDutyPolicyExecutionLog | null =
      await OnCallDutyPolicyExecutionLogService.findOneBy({
        query: {
          projectId: data.projectId,
          testPageFireDrillMonitorId: data.monitorId,
        },
        select: {
          _id: true,
          testPageFireDrillId: true,
        },
        sort: {
          createdAt: SortOrder.Descending,
        },
        props: {
          isRoot: true,
        },
      });

    if (!latest?.testPageFireDrillId) {
      return null;
    }

    const tests: Array<OnCallDutyPolicyExecutionLog> = (
      await OnCallDutyPolicyExecutionLogService.findBy({
        query: {
          projectId: data.projectId,
          testPageFireDrillMonitorId: data.monitorId,
          testPageFireDrillId: latest.testPageFireDrillId,
        },
        select: {
          _id: true,
          createdAt: true,
          status: true,
          userNotificationEventType: true,
          testPageRecordKind: true,
          testPageSeverityId: true,
          testPageWalksEscalation: true,
          testPageFireDrillId: true,
          testPageFireDrillFailure: true,
          createdByUserId: true,
          createdByUser: {
            name: true,
            email: true,
          },
          acknowledgedAt: true,
          acknowledgedByUserId: true,
          acknowledgedByUser: {
            name: true,
            email: true,
          },
          onCallDutyPolicyId: true,
          onCallDutyPolicy: {
            name: true,
          },
        },
        sort: {
          createdAt: SortOrder.Ascending,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      })
    ).filter((run: OnCallDutyPolicyExecutionLog): boolean => {
      return isOnCallTestPage(run);
    });

    const first: OnCallDutyPolicyExecutionLog | undefined = tests[0];

    if (!first) {
      return null;
    }

    if (
      !(await this.mayReadEveryTest({
        projectId: data.projectId,
        tests: tests,
        props: data.props,
      }))
    ) {
      return null;
    }

    const failure: OnCallFireDrillFailureRecord = readFailureRecord(
      first.testPageFireDrillFailure,
    );

    return {
      fireDrillId: latest.testPageFireDrillId.toString(),
      monitorId: data.monitorId.toString(),
      startedAt: (first.createdAt
        ? OneUptimeDate.fromString(first.createdAt)
        : OneUptimeDate.getCurrentDate()
      ).toISOString(),
      startedByName:
        first.createdByUser?.name?.toString() ||
        first.createdByUser?.email?.toString() ||
        "",
      failure: {
        criteriaName: failure.criteriaName,
        recordKind: isOnCallTestPageRecordKind(first.testPageRecordKind)
          ? first.testPageRecordKind
          : OnCallTestPageRecordKind.Incident,
        severityName: await OnCallTestPageService.readSeverityNameOf(first),
        ...(typeof failure.declaredAfterMinutes === "number"
          ? { declaredAfterMinutes: failure.declaredAfterMinutes }
          : {}),
      },
      walksEscalation: Boolean(first.testPageWalksEscalation),
      runs: await OnCallTestPageService.getResultSummaries({
        projectId: data.projectId,
        runs: tests,
      }),
    };
  }

  /*
   * Whether the reader may read every test of a drill, as they would list
   * them in the policies' execution logs: one they may not read - or a
   * reader who may read none - and the drill is not theirs to read.
   */
  private async mayReadEveryTest(data: {
    projectId: ObjectID;
    tests: Array<OnCallDutyPolicyExecutionLog>;
    props: DatabaseCommonInteractionProps;
  }): Promise<boolean> {
    const ids: Array<ObjectID> = data.tests.map(
      (test: OnCallDutyPolicyExecutionLog): ObjectID => {
        return test.id!;
      },
    );

    let readable: Array<OnCallDutyPolicyExecutionLog>;

    try {
      readable = await OnCallDutyPolicyExecutionLogService.findBy({
        query: {
          projectId: data.projectId,
          _id: QueryHelper.any(ids),
        },
        select: {
          _id: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: data.props,
      });
    } catch (err) {
      if (err instanceof NotAuthorizedException) {
        return false;
      }

      throw err;
    }

    const readableIds: Set<string> = new Set<string>(
      readable.map((run: OnCallDutyPolicyExecutionLog): string => {
        return run.id?.toString() || "";
      }),
    );

    return ids.every((id: ObjectID): boolean => {
      return readableIds.has(id.toString());
    });
  }
}

/*
 * The failure a drill's test keeps (testPageFireDrillFailure), as written:
 * the criteria's name, and how long an alert stays open before the incident
 * tested is declared from it. Anything else in it is left out.
 */
export function readFailureRecord(
  value: unknown,
): OnCallFireDrillFailureRecord {
  const record: { criteriaName?: unknown; declaredAfterMinutes?: unknown } =
    value && typeof value === "object"
      ? (value as { criteriaName?: unknown; declaredAfterMinutes?: unknown })
      : {};

  return {
    criteriaName:
      typeof record.criteriaName === "string" ? record.criteriaName : "",
    ...(typeof record.declaredAfterMinutes === "number" &&
    Number.isFinite(record.declaredAfterMinutes) &&
    record.declaredAfterMinutes >= 0
      ? { declaredAfterMinutes: record.declaredAfterMinutes }
      : {}),
  };
}

export default new OnCallFireDrillHistoryService();
