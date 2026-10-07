import ObjectID from "Common/Types/ObjectID";
import BadDataException from "Common/Types/Exception/BadDataException";
import UserNotificationExecutionStatus from "Common/Types/UserNotification/UserNotificationExecutionStatus";
import UserNotificationEventType from "Common/Types/UserNotification/UserNotificationEventType";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import UserOnCallLogService, {
  NO_LONGER_A_PROJECT_MEMBER_STATUS_MESSAGE,
} from "Common/Server/Services/UserOnCallLogService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import IncidentService from "Common/Server/Services/IncidentService";
import AlertService from "Common/Server/Services/AlertService";
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import logger from "Common/Server/Utils/Logger";
import ProjectMembership, {
  ProjectUserPair,
} from "Common/Server/Utils/TeamMember/ProjectMembership";
import UserOnCallLog from "Common/Models/DatabaseModels/UserOnCallLog";
import { describe, expect, test, afterEach, beforeEach } from "@jest/globals";

/*
 * ExecutePendingExecutions runs EVERY_MINUTE and, for each UserOnCallLog still
 * in `Executing`, fires the user's due escalation notification rules. Audit H3:
 * `Error` is a TERMINAL status — no worker re-selects an Error log
 * (ExecutePendingExecutions queries `Executing`, TimeoutStuckExecutions queries
 * `Started`). The old catch marked EVERY failure `Error`, so one transient DB
 * blip (connection reset / pool timeout) during a single tick permanently
 * dropped a user's not-yet-fired escalation steps — including the last-resort
 * "call at N minutes" page.
 *
 * The fix only marks `Error` when the caught error `instanceof
 * BadDataException` (a PERMANENT bad/missing-data failure a retry cannot fix).
 * For any other (transient/unknown) error it logs and LEAVES the log
 * `Executing`, so the next tick retries. Retries are idempotent — the loop
 * skips rules already in `executedNotificationRules`.
 *
 * These tests import the worker's inner `executePendingNotificationLog`
 * (exported for testability) with the Cron util mocked to a no-op so
 * RunCron does not enqueue anything at import time, then drive:
 *   (1) PERMANENT (BadDataException) => updateOneById called with status Error,
 *   (2) TRANSIENT (generic Error)   => updateOneById NOT called => left
 *       Executing for the next tick to retry,
 *   (3) happy path (no due rules)   => updateOneById called with status
 *       Completed, proving the catch is not triggered on success.
 */

// Mock the worker's Cron util so RunCron is a no-op (no queue side effects).
jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

// Import AFTER the jest.mock above (hoisted by jest) so RunCron is already a no-op.
import { executePendingNotificationLog } from "../../../../FeatureSet/Workers/Jobs/UserOnCallLog/ExecutePendingExecutions";
import RunCron from "../../../../FeatureSet/Workers/Utils/Cron";

// The tick itself: what the job registered with RunCron when it was imported.
const runTick: () => Promise<void> = (RunCron as unknown as jest.Mock).mock
  .calls[0]![2] as () => Promise<void>;

const MEMBER: { isProjectMember: boolean } = { isProjectMember: true };

type PendingLog = Parameters<typeof executePendingNotificationLog>[0];

function makePendingLog(
  overrides: Partial<Record<string, unknown>> = {},
): PendingLog {
  /*
   * createdAt a few minutes ago so any due rule (notifyAfterMinutes <= elapsed)
   * would be considered due.
   */
  const createdAt: Date = new Date(Date.now() - 5 * 60 * 1000);

  return {
    id: new ObjectID("log1"),
    _id: "log1",
    projectId: new ObjectID("p1"),
    userId: new ObjectID("u1"),
    createdAt,
    executedNotificationRules: {},
    userNotificationEventType: UserNotificationEventType.IncidentCreated,
    ...overrides,
  } as unknown as PendingLog;
}

describe("ExecutePendingExecutions.executePendingNotificationLog", () => {
  beforeEach(() => {
    // Silence the catch-path logger.error noise.
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("PERMANENT failure (BadDataException) => log is marked Error", async () => {
    // First call in the function throws a permanent bad-data error.
    jest
      .spyOn(UserOnCallLogService, "getNotificationRuleType")
      .mockImplementation((): NotificationRuleType => {
        throw new BadDataException("bad");
      });

    const updateSpy: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await executePendingNotificationLog(makePendingLog(), MEMBER);

    // The permanent-failure branch marks the log Error.
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const callArg: any = updateSpy.mock.calls[0]![0];
    expect(callArg.data.status).toBe(UserNotificationExecutionStatus.Error);
  });

  test("TRANSIENT failure (generic Error) => log is LEFT Executing (no Error mark)", async () => {
    // Same early call, but a transient/unknown error a retry could fix.
    jest
      .spyOn(UserOnCallLogService, "getNotificationRuleType")
      .mockImplementation((): NotificationRuleType => {
        throw new Error("db connection reset");
      });

    const updateSpy: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await executePendingNotificationLog(makePendingLog(), MEMBER);

    /*
     * The log must NOT be marked Error (it stays Executing for the next tick).
     * Ideally the catch does not touch updateOneById at all.
     */
    expect(updateSpy).not.toHaveBeenCalled();

    const markedError: boolean = updateSpy.mock.calls.some(
      (call: Array<any>) => {
        return (
          call[0] &&
          call[0].data &&
          call[0].data.status === UserNotificationExecutionStatus.Error
        );
      },
    );
    expect(markedError).toBe(false);
  });

  test("happy path (no due rules) => log is marked Completed (catch not triggered)", async () => {
    // Return a valid rule type so we proceed past the first call.
    jest
      .spyOn(UserOnCallLogService, "getNotificationRuleType")
      .mockReturnValue(NotificationRuleType.ON_CALL_EXECUTED_INCIDENT);

    // Incident exists so the "nothing found" guard does not throw.
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue({
      incidentSeverityId: new ObjectID("sev1"),
    } as never);
    /*
     * Not acknowledged, so we do not short-circuit to the acknowledged-Completed
     * branch and instead reach the notification-rules loop.
     */
    jest
      .spyOn(IncidentService, "isIncidentAcknowledged")
      .mockResolvedValue(false as never);

    // No notification rules => the loop is empty => isAllExecuted stays true.
    jest
      .spyOn(UserNotificationRuleService, "findBy")
      .mockResolvedValue([] as never);

    // Guard against any accidental sibling-entity lookups.
    jest.spyOn(AlertService, "findOneById").mockResolvedValue(null as never);
    jest
      .spyOn(AlertEpisodeService, "findOneById")
      .mockResolvedValue(null as never);
    jest
      .spyOn(IncidentEpisodeService, "findOneById")
      .mockResolvedValue(null as never);

    const updateSpy: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await executePendingNotificationLog(
      makePendingLog({ triggeredByIncidentId: new ObjectID("inc1") }),
      MEMBER,
    );

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const callArg: any = updateSpy.mock.calls[0]![0];
    expect(callArg.data.status).toBe(UserNotificationExecutionStatus.Completed);

    // Catch was never entered on the success path.
    expect(logger.error).not.toHaveBeenCalled();
  });
});

/*
 * A log keeps running its later rules for as long as the event is not
 * acknowledged, so the person it pages may leave the project while it runs.
 * Somebody who is no longer a member is not paged again: the log ends with
 * the reason, and the rules still due for them are not run. Membership is
 * read once per tick for every pending log (ProjectMembership).
 */
describe("ExecutePendingExecutions - the person paged left the project", () => {
  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the log ends with the reason, and no rule of theirs is run", async () => {
    const ruleType: jest.SpyInstance = jest.spyOn(
      UserOnCallLogService,
      "getNotificationRuleType",
    );
    const rules: jest.SpyInstance = jest.spyOn(
      UserNotificationRuleService,
      "findBy",
    );
    const updateSpy: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await executePendingNotificationLog(
      makePendingLog({ triggeredByIncidentId: new ObjectID("inc1") }),
      { isProjectMember: false },
    );

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const callArg: any = updateSpy.mock.calls[0]![0];
    expect(callArg.id.toString()).toBe("log1");
    expect(callArg.data).toEqual({
      status: UserNotificationExecutionStatus.Completed,
      statusMessage: NO_LONGER_A_PROJECT_MEMBER_STATUS_MESSAGE,
    });
    expect(ruleType).not.toHaveBeenCalled();
    expect(rules).not.toHaveBeenCalled();
  });

  test("one membership read per tick, for every pending log; only members' logs go on", async () => {
    const STAYING: ObjectID = new ObjectID(
      "10000000-0000-4000-8000-000000000001",
    );
    const LEAVING: ObjectID = new ObjectID(
      "20000000-0000-4000-8000-000000000002",
    );
    const PROJECT_1: ObjectID = new ObjectID(
      "aaaaaaaa-0000-4000-8000-000000000001",
    );
    const PROJECT_2: ObjectID = new ObjectID(
      "bbbbbbbb-0000-4000-8000-000000000002",
    );

    const logs: Array<UserOnCallLog> = [
      makePendingLog({
        id: new ObjectID("log-staying"),
        projectId: PROJECT_1,
        userId: STAYING,
      }),
      makePendingLog({
        id: new ObjectID("log-leaving"),
        projectId: PROJECT_1,
        userId: LEAVING,
      }),
      // A member of PROJECT_2 still - membership is per project.
      makePendingLog({
        id: new ObjectID("log-leaving-other-project"),
        projectId: PROJECT_2,
        userId: LEAVING,
      }),
    ] as unknown as Array<UserOnCallLog>;

    jest
      .spyOn(UserOnCallLogService, "findAllBy")
      .mockResolvedValue(logs as never);

    const membershipReads: Array<Array<ProjectUserPair>> = [];

    jest
      .spyOn(ProjectMembership, "getMemberKeys")
      .mockImplementation(
        async (pairs: Array<ProjectUserPair>): Promise<Set<string>> => {
          membershipReads.push(pairs);

          return new Set<string>([
            ProjectMembership.getKey(PROJECT_1, STAYING),
            ProjectMembership.getKey(PROJECT_2, LEAVING),
          ]);
        },
      );

    // Members' logs go on to their rules; stop them there.
    const ruleType: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "getNotificationRuleType")
      .mockImplementation((): NotificationRuleType => {
        throw new Error("stop here");
      });
    const updateSpy: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await runTick();

    expect(membershipReads).toHaveLength(1);
    expect(
      membershipReads[0]!.map((pair: ProjectUserPair): string => {
        return ProjectMembership.getKey(pair.projectId, pair.userId);
      }),
    ).toEqual([
      ProjectMembership.getKey(PROJECT_1, STAYING),
      ProjectMembership.getKey(PROJECT_1, LEAVING),
      ProjectMembership.getKey(PROJECT_2, LEAVING),
    ]);

    // The member logs went on to their rules...
    expect(ruleType).toHaveBeenCalledTimes(2);

    // ...the former member's log in PROJECT_1 ended, and only that one.
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const callArg: any = updateSpy.mock.calls[0]![0];
    expect(callArg.id.toString()).toBe("log-leaving");
    expect(callArg.data.statusMessage).toBe(
      NO_LONGER_A_PROJECT_MEMBER_STATUS_MESSAGE,
    );
  });

  test("membership that cannot be read runs every log as before, rather than none", async () => {
    const logs: Array<UserOnCallLog> = [
      makePendingLog({ id: new ObjectID("log-a") }),
      makePendingLog({ id: new ObjectID("log-b") }),
    ] as unknown as Array<UserOnCallLog>;

    jest
      .spyOn(UserOnCallLogService, "findAllBy")
      .mockResolvedValue(logs as never);
    jest
      .spyOn(ProjectMembership, "getMemberKeys")
      .mockRejectedValue(new Error("database unavailable"));

    const ruleType: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "getNotificationRuleType")
      .mockImplementation((): NotificationRuleType => {
        throw new Error("stop here");
      });
    const updateSpy: jest.SpyInstance = jest
      .spyOn(UserOnCallLogService, "updateOneById")
      .mockResolvedValue(undefined as never);

    await runTick();

    // Both logs went on to their rules; neither was ended as a former member's.
    expect(ruleType).toHaveBeenCalledTimes(2);
    expect(
      updateSpy.mock.calls.some((call: Array<any>) => {
        return (
          call[0]?.data?.statusMessage ===
          NO_LONGER_A_PROJECT_MEMBER_STATUS_MESSAGE
        );
      }),
    ).toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });
});
