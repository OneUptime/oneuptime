import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";
import UserOnCallLog from "Common/Models/DatabaseModels/UserOnCallLog";
import UserNotificationExecutionStatus from "Common/Types/UserNotification/UserNotificationExecutionStatus";
import RunCron from "../../../../FeatureSet/Workers/Utils/Cron";
import "../../../../FeatureSet/Workers/Jobs/UserOnCallLog/ExecutePendingExecutions";
import {
  USER_LOG_HANDED_OVER_STATUS_MESSAGE,
  USER_LOG_TIMED_OUT_STATUS_MESSAGE,
} from "../../../../FeatureSet/Workers/Jobs/UserOnCallLog/TimeoutStuckExecutions";
import PersonPageFailureWorld, {
  PersonPageStep,
} from "./PersonPageFailureWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A RULE'S PAGE SURVIVES A DATABASE ERROR AFTER ITS CLAIM (issue #8407).
 *
 * A person's rule is claimed on their log before it is sent, so two ticks
 * never send it twice. Between the claim and the send, the send reads the
 * rule, the project's Twilio settings, the incident, and writes the
 * notification's row: a database error in any of those kept the claim
 * with nothing sent, and the next tick found the rule claimed - "call me
 * after 10 minutes" was never sent at all.
 *
 * Now a send that fails before anything of it reached a sender gives its
 * claim back, and the next try sends the rule - once. One that reached a
 * sender keeps its claim: nobody is paged twice. A give-back that fails,
 * and a worker that stops between the claim and the send, are settled at
 * the log's next try. And a log whose start fails or stops is handed to
 * the worker, rather than ended in Error with nobody paged by it.
 *
 * Driven through the real log start (UserOnCallLogService.onCreateSuccess),
 * the ticks the person's-log worker and the stuck-log job register with
 * RunCron, and the real rule send down to the push sender, over
 * PersonPageFailureWorld.
 */

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

function registeredTick(name: string): () => Promise<void> {
  return (RunCron as unknown as jest.Mock).mock.calls.find(
    (call: Array<unknown>): boolean => {
      return call[0] === name;
    },
  )![2] as () => Promise<void>;
}

const workerTick: () => Promise<void> = registeredTick(
  "UserOnCallLog:ExecutePendingExecutions",
);
const stuckJobTick: () => Promise<void> = registeredTick(
  "UserOnCallLog:TimeoutStuckExecutions",
);

let world: PersonPageFailureWorld;

beforeEach(() => {
  world = new PersonPageFailureWorld();
  world.install();
  world.useTicks({ worker: workerTick, stuckJob: stuckJobTick });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Whether any rule was pushed more than once on any log.
function anybodyPagedTwice(): boolean {
  const seen: Set<string> = new Set();

  for (const push of world.pushes) {
    const key: string = `${push.logId}|${push.ruleId}`;

    if (seen.has(key)) {
      return true;
    }

    seen.add(key);
  }

  return false;
}

// Only a call for rule `rule`'s own send.
function forRule(
  rule: UserNotificationRule,
): (args: Array<unknown>) => boolean {
  return (args: Array<unknown>): boolean => {
    return args[0] === rule.id!.toString();
  };
}

// The worker ticks each minute up to `minute`.
async function ticksUntil(minute: number): Promise<void> {
  while (world.minutesSinceStart() < minute) {
    await world.workerTickAfter(1);
  }
}

describe("a database error after a rule's claim, before anything was sent", () => {
  test("REGRESSION: the claim is given back, and the rule is sent the next minute, once", async () => {
    const atOnce: UserNotificationRule = world.rule(1, 0);
    const later: UserNotificationRule = world.rule(2, 5);
    const log: UserOnCallLog = world.log(1);
    world.failAt(PersonPageStep.ReadRule, { when: forRule(atOnce) });

    await world.workerTickAfter(0);

    // Nothing sent, and nothing claimed: the rule is still due.
    expect(world.pushes).toEqual([]);
    expect(world.claimsOn(log)).toEqual([]);
    expect(world.claimInFlight(log)).toBeNull();

    await world.workerTickAfter(1);

    expect(world.pushLine()).toEqual(["1 @ 1"]);

    await ticksUntil(6);

    expect(world.pushLine()).toEqual(["1 @ 1", "2 @ 5"]);
    expect(world.timesPushed(log, atOnce)).toBe(1);
    expect(world.timesPushed(log, later)).toBe(1);
    expect(anybodyPagedTwice()).toBe(false);
  });

  test.each([
    ["the read of the rule", PersonPageStep.ReadRule],
    [
      "the read of the project's Twilio settings",
      PersonPageStep.ReadTwilioSettings,
    ],
    ["the read of the incident", PersonPageStep.ReadIncident],
    ["the write of the notification's row", PersonPageStep.WriteNotification],
    [
      "the push's message, after its row was written",
      PersonPageStep.BuildMessage,
    ],
  ])(
    "a failure of %s: the rule is sent the next minute, once",
    async (_name: string, step: PersonPageStep) => {
      const call: UserNotificationRule = world.rule(1, 10);
      const log: UserOnCallLog = world.log(1, { minutesAgo: 10 });
      world.failAt(step);

      await world.workerTickAfter(0);

      expect(world.pushes).toEqual([]);
      expect(world.claimsOn(log)).toEqual([]);

      await world.workerTickAfter(1);

      expect(world.timesPushed(log, call)).toBe(1);
      expect(world.claimsOn(log)).toEqual([call.id!.toString()]);

      await world.workerTickAfter(1);
      await world.workerTickAfter(1);

      // Sent: the log is done, and nothing is sent again.
      expect(world.timesPushed(log, call)).toBe(1);
      expect(world.statusOf(log)).toBe(
        UserNotificationExecutionStatus.Completed,
      );
    },
  );

  test("a rule that fails again and again is sent once its failures pass, and its log is never ended while they do", async () => {
    const call: UserNotificationRule = world.rule(1, 0);
    const log: UserOnCallLog = world.log(1);
    world.failAt(PersonPageStep.ReadIncident, { times: 4 });

    await world.workerTickAfter(0);
    await ticksUntil(12);

    // Tried at 0, 1, 3, 7 - failed each time - then sent at 12.
    expect(world.pushLine()).toEqual(["1 @ 12"]);
    expect(world.timesPushed(log, call)).toBe(1);
    expect(world.keptFailures(log)).toBeNull();
  });

  test("the other rules of the person due in that minute are sent the next one, each once", async () => {
    const push: UserNotificationRule = world.rule(1, 0);
    const secondPhone: UserNotificationRule = world.rule(2, 0);
    const log: UserOnCallLog = world.log(1);
    world.failAt(PersonPageStep.ReadRule, { when: forRule(secondPhone) });

    await world.workerTickAfter(0);

    // The first went out; the second failed, gave its claim back.
    expect(world.pushLine()).toEqual(["1 @ 0"]);
    expect(world.claimsOn(log)).toEqual([push.id!.toString()]);

    await world.workerTickAfter(1);

    expect(world.pushLine()).toEqual(["1 @ 0", "2 @ 1"]);
    expect(anybodyPagedTwice()).toBe(false);
  });
});

describe("a failure after the page reached its sender", () => {
  test("keeps the claim: the push is not sent again", async () => {
    const call: UserNotificationRule = world.rule(1, 0);
    const log: UserOnCallLog = world.log(1);
    // The push service refuses the request: it was handed over, and its row says how it went.
    world.failAt(PersonPageStep.Push);

    await world.workerTickAfter(0);
    await ticksUntil(5);

    expect(world.timesPushed(log, call)).toBe(1);
    expect(world.claimsOn(log)).toEqual([call.id!.toString()]);
    expect(world.claimInFlight(log)).toBeNull();
  });

  test("a process that stops just after a push was handed over does not send it again after the restart", async () => {
    const call: UserNotificationRule = world.rule(1, 0);
    const later: UserNotificationRule = world.rule(2, 4);
    const log: UserOnCallLog = world.log(1);
    world.crashAt(PersonPageStep.Push);

    await world.workerTickAfter(0);

    // The push left; the process stopped before it could forget the claim in flight.
    expect(world.timesPushed(log, call)).toBe(1);
    expect(world.claimInFlight(log)).not.toBeNull();

    await ticksUntil(6);

    // Settled: its notification was written, so it may have been sent - it is not sent again.
    expect(world.timesPushed(log, call)).toBe(1);
    expect(world.timesPushed(log, later)).toBe(1);
    expect(world.claimInFlight(log)).toBeNull();
    expect(anybodyPagedTwice()).toBe(false);
  });
});

describe("a give-back that fails too", () => {
  test("is owed, and the next try gives it back and sends the rule, once", async () => {
    const call: UserNotificationRule = world.rule(1, 0);
    const log: UserOnCallLog = world.log(1);
    world.failAt(PersonPageStep.ReadIncident);
    world.failAt(PersonPageStep.GiveBack);

    await world.workerTickAfter(0);

    // Still claimed in the database, and owed back in Redis.
    expect(world.claimsOn(log)).toEqual([call.id!.toString()]);
    expect(world.claimInFlight(log)).toMatchObject({ owed: true });
    expect(world.pushes).toEqual([]);

    await world.workerTickAfter(1);

    expect(world.timesPushed(log, call)).toBe(1);
    expect(world.claimInFlight(log)).toBeNull();

    await ticksUntil(5);

    expect(world.timesPushed(log, call)).toBe(1);
  });

  test("a give-back that keeps failing is tried at each of the log's tries, and the rule is sent once it goes through", async () => {
    const call: UserNotificationRule = world.rule(1, 0);
    const log: UserOnCallLog = world.log(1);
    world.failAt(PersonPageStep.ReadIncident);
    world.failAt(PersonPageStep.GiveBack, { times: 3 });

    await world.workerTickAfter(0);
    await ticksUntil(10);

    expect(world.timesPushed(log, call)).toBe(1);
    expect(world.claimInFlight(log)).toBeNull();
    expect(anybodyPagedTwice()).toBe(false);
  });
});

describe("a worker that stops between a rule's claim and its send", () => {
  test("REGRESSION: the claim is left to its page for two minutes, then given back, and the rule is sent once", async () => {
    const call: UserNotificationRule = world.rule(1, 0);
    const log: UserOnCallLog = world.log(1);
    world.crashAt(PersonPageStep.ReadRule);

    await world.workerTickAfter(0);

    // Claimed, nothing sent, and no catch ran to give it back.
    expect(world.claimsOn(log)).toEqual([call.id!.toString()]);
    expect(world.claimInFlight(log)).toMatchObject({ owed: false });

    // A minute on, its page might still be on its way: left alone.
    await world.workerTickAfter(1);
    expect(world.pushes).toEqual([]);

    await world.workerTickAfter(1);

    expect(world.pushLine()).toEqual(["1 @ 2"]);

    await ticksUntil(6);

    expect(world.timesPushed(log, call)).toBe(1);
  });

  test("one that stopped after the notification's row was written keeps its claim: it may have been sent", async () => {
    const call: UserNotificationRule = world.rule(1, 0);
    const log: UserOnCallLog = world.log(1);
    world.crashAt(PersonPageStep.BuildMessage);

    await world.workerTickAfter(0);
    await ticksUntil(6);

    expect(world.timesPushed(log, call)).toBe(0);
    expect(world.claimsOn(log)).toEqual([call.id!.toString()]);
    expect(world.claimInFlight(log)).toBeNull();
    expect(
      world.warnings.some((line: string) => {
        return line.includes("it may have been sent, so it is not sent again");
      }),
    ).toBe(true);
  });

  test("a Redis that is down keeps no claim in flight, and a failed send still gives its claim back", async () => {
    const call: UserNotificationRule = world.rule(1, 0);
    const log: UserOnCallLog = world.log(1);
    world.isRedisDown = true;
    world.failAt(PersonPageStep.ReadIncident);

    await world.workerTickAfter(0);
    await world.workerTickAfter(1);

    expect(world.timesPushed(log, call)).toBe(1);
  });
});

describe("a person's log whose start fails", () => {
  test("REGRESSION: an immediate rule's failure hands the log to the worker, which sends it the next minute, once", async () => {
    const atOnce: UserNotificationRule = world.rule(1, 0);
    const later: UserNotificationRule = world.rule(2, 5);
    const log: UserOnCallLog = world.log(1, {
      status: UserNotificationExecutionStatus.Scheduled,
    });
    world.failAt(PersonPageStep.ReadIncident, {
      // The send's read, not the start's own read of the incident's severity.
      when: (): boolean => {
        return world.callsAt(PersonPageStep.ReadIncident) > 1;
      },
    });

    // The page that wrote the log is not failed by it.
    await expect(world.startLog(log)).resolves.toBeUndefined();

    expect(world.statusOf(log)).toBe(UserNotificationExecutionStatus.Executing);
    expect(world.pushes).toEqual([]);

    await world.workerTickAfter(1);

    expect(world.pushLine()).toEqual(["1 @ 1"]);

    await ticksUntil(6);

    expect(world.pushLine()).toEqual(["1 @ 1", "2 @ 5"]);
    expect(world.timesPushed(log, atOnce)).toBe(1);
    expect(world.timesPushed(log, later)).toBe(1);
  });

  test("REGRESSION: a start whose process stopped is handed over five minutes on, and its rules are sent, each once", async () => {
    const atOnce: UserNotificationRule = world.rule(1, 0);
    const later: UserNotificationRule = world.rule(2, 10);
    const log: UserOnCallLog = world.log(1, {
      status: UserNotificationExecutionStatus.Scheduled,
    });
    world.crashAt(PersonPageStep.ReadRule);

    await expect(world.startLog(log)).rejects.toThrow();

    // Started, its immediate rule claimed, nothing sent.
    expect(world.statusOf(log)).toBe(UserNotificationExecutionStatus.Started);

    for (let minute: number = 1; minute <= 12; minute++) {
      await world.minutePasses();
    }

    // Handed over at 5 - not ended in Error - and its immediate rule given back and sent.
    expect(world.pushLine()).toEqual(["1 @ 5", "2 @ 10"]);
    expect(world.timesPushed(log, atOnce)).toBe(1);
    expect(world.timesPushed(log, later)).toBe(1);
    expect(
      world.statusWrites.some((write: { status: string }) => {
        return write.status === UserNotificationExecutionStatus.Error;
      }),
    ).toBe(false);
    expect(anybodyPagedTwice()).toBe(false);
  });

  test("a start whose last write failed is handed over five minutes on, and sends nothing its start sent", async () => {
    const atOnce: UserNotificationRule = world.rule(1, 0);
    const log: UserOnCallLog = world.log(1, {
      status: UserNotificationExecutionStatus.Scheduled,
    });
    world.failAt(PersonPageStep.WriteStatus, {
      when: (args: Array<unknown>) => {
        return (
          (args[0] as { data: { status?: string } }).data.status ===
          UserNotificationExecutionStatus.Executing
        );
      },
    });

    await expect(world.startLog(log)).rejects.toThrow();

    expect(world.pushLine()).toEqual(["1 @ 0"]);
    expect(world.statusOf(log)).toBe(UserNotificationExecutionStatus.Started);

    for (let minute: number = 1; minute <= 7; minute++) {
      await world.minutePasses();
    }

    expect(world.statusMessageOf(log)).toBe(
      USER_LOG_HANDED_OVER_STATUS_MESSAGE,
    );
    expect(world.timesPushed(log, atOnce)).toBe(1);
    expect(world.statusOf(log)).toBe(UserNotificationExecutionStatus.Completed);
  });

  test("a log left Scheduled - its start never ran - is handed over and sent", async () => {
    const atOnce: UserNotificationRule = world.rule(1, 0);
    const log: UserOnCallLog = world.log(1, {
      status: UserNotificationExecutionStatus.Scheduled,
    });

    for (let minute: number = 1; minute <= 6; minute++) {
      await world.minutePasses();
    }

    expect(world.pushLine()).toEqual(["1 @ 5"]);
    expect(world.timesPushed(log, atOnce)).toBe(1);
  });

  test("a stuck log about an incident acknowledged since is handed over, and sends nothing", async () => {
    world.rule(1, 0);
    const log: UserOnCallLog = world.log(1, {
      status: UserNotificationExecutionStatus.Started,
    });
    world.isIncidentAcknowledged = true;

    for (let minute: number = 1; minute <= 6; minute++) {
      await world.minutePasses();
    }

    expect(world.pushes).toEqual([]);
    expect(world.statusOf(log)).toBe(UserNotificationExecutionStatus.Completed);
    expect(world.statusMessageOf(log)).toBe(
      "Execution completed because incident is acknowledged.",
    );
  });

  test("a log that started more than an hour ago is too old to page for now, and ends in Error, as before", async () => {
    world.rule(1, 0);
    const log: UserOnCallLog = world.log(1, {
      status: UserNotificationExecutionStatus.Started,
      minutesAgo: 61,
    });

    await world.minutePasses();

    expect(world.pushes).toEqual([]);
    expect(world.statusOf(log)).toBe(UserNotificationExecutionStatus.Error);
    expect(world.statusMessageOf(log)).toBe(USER_LOG_TIMED_OUT_STATUS_MESSAGE);
  });

  test("a log still starting is not handed over before five minutes", async () => {
    world.rule(1, 0);
    const log: UserOnCallLog = world.log(1, {
      status: UserNotificationExecutionStatus.Started,
    });

    for (let minute: number = 1; minute <= 4; minute++) {
      await world.minutePasses();
    }

    expect(world.statusOf(log)).toBe(UserNotificationExecutionStatus.Started);
    expect(world.pushes).toEqual([]);
  });
});
