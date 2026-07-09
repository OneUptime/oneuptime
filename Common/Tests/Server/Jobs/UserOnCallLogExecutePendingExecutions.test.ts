import ObjectID from "../../../Types/ObjectID";
import BadDataException from "../../../Types/Exception/BadDataException";
import UserNotificationExecutionStatus from "../../../Types/UserNotification/UserNotificationExecutionStatus";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import IncidentService from "../../../Server/Services/IncidentService";
import AlertService from "../../../Server/Services/AlertService";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import logger from "../../../Server/Utils/Logger";
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

// Mock the App worker's Cron util so RunCron is a no-op (no queue side effects).
jest.mock("../../../../App/FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

// Import AFTER the jest.mock above (hoisted by jest) so RunCron is already a no-op.
import { executePendingNotificationLog } from "../../../../App/FeatureSet/Workers/Jobs/UserOnCallLog/ExecutePendingExecutions";

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

    await executePendingNotificationLog(makePendingLog());

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

    await executePendingNotificationLog(makePendingLog());

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
    );

    expect(updateSpy).toHaveBeenCalledTimes(1);
    const callArg: any = updateSpy.mock.calls[0]![0];
    expect(callArg.data.status).toBe(UserNotificationExecutionStatus.Completed);

    // Catch was never entered on the success path.
    expect(logger.error).not.toHaveBeenCalled();
  });
});
