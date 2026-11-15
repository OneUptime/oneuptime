import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";
import UserOnCallLog from "Common/Models/DatabaseModels/UserOnCallLog";
import BadDataException from "Common/Types/Exception/BadDataException";
import UserNotificationExecutionStatus from "Common/Types/UserNotification/UserNotificationExecutionStatus";
import RunCron from "../../../../FeatureSet/Workers/Utils/Cron";
import "../../../../FeatureSet/Workers/Jobs/UserOnCallLog/ExecutePendingExecutions";
import "../../../../FeatureSet/Workers/Jobs/UserOnCallLog/TimeoutStuckExecutions";
import PersonPageFailureWorld, {
  connectionReset,
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
 * THE PERSON'S-LOG WORKER STOPS RETRYING A LOG THAT KEEPS FAILING
 * (issue #8408).
 *
 * Every minute the worker (UserOnCallLog:ExecutePendingExecutions) sends a
 * person's On-Call Rules that are due. A log whose try failed for anything
 * but bad data stayed Executing and was tried again the next minute - and
 * the next, forever: a log that failed for a bug failed every minute, and
 * logged an error every minute, and was never ended (#8106 was one).
 *
 * Now a log that fails is tried again after a minute, two, four, then
 * every five (OnCallPolicyRunRetry), and one that fails ten tries in a
 * row - about 37 minutes - ends in Error, saying how long it was tried and
 * what the last try failed with. Bad data still ends it at once; a blip
 * that passes is sent from the next try, once. The tries are kept in
 * Redis, so a restart counts on.
 *
 * Driven through the tick the worker registers with RunCron and the real
 * rule send (executeNotificationRuleItem and the delivery half, down to
 * the push sender), over PersonPageFailureWorld.
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

// A bug: what a log that fails for one throws, every try.
function bug(): Error {
  return new TypeError("Cannot read properties of undefined (reading 'id')");
}

let world: PersonPageFailureWorld;

beforeEach(() => {
  world = new PersonPageFailureWorld();
  world.install();
  world.useTicks({ worker: workerTick, stuckJob: stuckJobTick });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The worker ticks each minute up to `minute`, from the minute after the last tick.
async function ticksUntil(minute: number): Promise<void> {
  while (world.minutesSinceStart() < minute) {
    await world.workerTickAfter(1);
  }
}

describe("a person's log that fails every try", () => {
  test("REGRESSION: is tried at 0, 1, 3, 7, 12... minutes and ends in Error after ten tries, saying why - not every minute, forever", async () => {
    world.rule(1, 0);
    const log: UserOnCallLog = world.log(1);
    world.failAlwaysAt(PersonPageStep.ReadRules, bug);

    await world.workerTickAfter(0);
    await ticksUntil(60);

    // Ten tries, waiting longer each time - not sixty-one.
    expect(world.callsAt(PersonPageStep.ReadRules)).toBe(10);
    expect(world.statusOf(log)).toBe(UserNotificationExecutionStatus.Error);
    expect(world.statusMessageOf(log)).toBe(
      "OneUptime tried 10 times in 37 minutes to send this page's notifications, and every try failed, so it stopped. The last try failed with: Cannot read properties of undefined (reading 'id'). If the incident still needs this person, page them again.",
    );
    // Ended once, and forgotten.
    expect(
      world.statusWrites.filter((write: { status: string }) => {
        return write.status === UserNotificationExecutionStatus.Error;
      }),
    ).toHaveLength(1);
    expect(world.keptFailures(log)).toBeNull();
    expect(world.pushes).toEqual([]);
  });

  test("its tries are a minute, two, four, then five apart", async () => {
    world.rule(1, 0);
    world.log(1);
    world.failAlwaysAt(PersonPageStep.ReadRules, bug);

    const triedAt: Array<number> = [];
    let tries: number = 0;

    await world.workerTickAfter(0);

    for (let minute: number = 0; minute <= 40; minute++) {
      if (world.callsAt(PersonPageStep.ReadRules) > tries) {
        tries = world.callsAt(PersonPageStep.ReadRules);
        triedAt.push(world.minutesSinceStart());
      }

      await world.workerTickAfter(1);
    }

    expect(triedAt).toEqual([0, 1, 3, 7, 12, 17, 22, 27, 32, 37]);
  });

  test("a bug is logged as one at each try, and each try says which of ten it was", async () => {
    world.rule(1, 0);
    world.log(1);
    world.failAlwaysAt(PersonPageStep.ReadRules, bug);

    await world.workerTickAfter(0);
    await world.workerTickAfter(1);

    expect(
      world.errors.filter((line: string) => {
        return line.includes("try 2 of 10 failed");
      }),
    ).toHaveLength(1);
  });

  test("bad data ends it at once, as before: a retry cannot fix it", async () => {
    world.rule(1, 0);
    const log: UserOnCallLog = world.log(1);
    world.failAlwaysAt(PersonPageStep.ReadRules, () => {
      return new BadDataException("The page's event type is not known.");
    });

    await world.workerTickAfter(0);

    expect(world.statusOf(log)).toBe(UserNotificationExecutionStatus.Error);
    expect(world.statusMessageOf(log)).toBe(
      "The page's event type is not known.",
    );
    expect(world.callsAt(PersonPageStep.ReadRules)).toBe(1);
    expect(world.keptFailures(log)).toBeNull();
  });

  test("an Error the database fails to write is written at the next try", async () => {
    world.rule(1, 0);
    const log: UserOnCallLog = world.log(1);
    world.failAlwaysAt(PersonPageStep.ReadRules, bug);
    world.failAt(PersonPageStep.WriteStatus, {
      when: (args: Array<unknown>) => {
        return (
          (args[0] as { data: { status?: string } }).data.status ===
          UserNotificationExecutionStatus.Error
        );
      },
    });

    await world.workerTickAfter(0);
    await ticksUntil(37);

    // Its tenth try failed, and so did the write that ends it.
    expect(world.statusOf(log)).toBe(UserNotificationExecutionStatus.Executing);

    await ticksUntil(45);

    expect(world.statusOf(log)).toBe(UserNotificationExecutionStatus.Error);
    expect(world.statusMessageOf(log)).toContain("every try failed");
  });
});

describe("a person's log whose try fails for a blip", () => {
  test("is sent from the next try, a minute later, once, and its failure is forgotten", async () => {
    const atOnce: UserNotificationRule = world.rule(1, 0);
    const later: UserNotificationRule = world.rule(2, 5);
    const log: UserOnCallLog = world.log(1);
    world.failAt(PersonPageStep.ReadRules, { error: connectionReset });

    await world.workerTickAfter(0);

    expect(world.pushes).toEqual([]);
    expect(world.keptFailures(log)).toMatchObject({ failedTries: 1 });
    expect(world.statusOf(log)).toBe(UserNotificationExecutionStatus.Executing);

    await world.workerTickAfter(1);

    expect(world.pushLine()).toEqual(["1 @ 1"]);
    expect(world.keptFailures(log)).toBeNull();

    await ticksUntil(6);

    expect(world.pushLine()).toEqual(["1 @ 1", "2 @ 5"]);
    expect(world.timesPushed(log, atOnce)).toBe(1);
    expect(world.timesPushed(log, later)).toBe(1);
  });

  test("a log that failed twice waits its turn: its next try is two minutes on, not one", async () => {
    world.rule(1, 0);
    world.log(1);
    world.failAt(PersonPageStep.ReadRules, { times: 2 });

    await world.workerTickAfter(0);
    await world.workerTickAfter(1);
    await world.workerTickAfter(1);

    // Minute 2: not tried.
    expect(world.callsAt(PersonPageStep.ReadRules)).toBe(2);
    expect(world.pushes).toEqual([]);

    await world.workerTickAfter(1);

    expect(world.pushLine()).toEqual(["1 @ 3"]);
  });

  test("a log that went on after failures counts from one at its next failure", async () => {
    world.rule(1, 0);
    world.rule(2, 10);
    const log: UserOnCallLog = world.log(1);
    world.failAt(PersonPageStep.ReadRules, { times: 3 });

    await world.workerTickAfter(0);
    await ticksUntil(7);

    expect(world.pushLine()).toEqual(["1 @ 7"]);
    expect(world.keptFailures(log)).toBeNull();

    world.failAt(PersonPageStep.ReadRules);
    await world.workerTickAfter(1);

    expect(world.keptFailures(log)).toMatchObject({ failedTries: 1 });
  });

  test("one log's failures hold up nobody else's page", async () => {
    const atOnce: UserNotificationRule = world.rule(1, 0);
    const later: UserNotificationRule = world.rule(2, 3);
    const failing: UserOnCallLog = world.log(1);
    const healthy: UserOnCallLog = world.log(2);
    world.failAt(PersonPageStep.WriteNotification, {
      times: Number.MAX_SAFE_INTEGER,
      when: (args: Array<unknown>) => {
        return args[0] === failing.id!.toString();
      },
      error: bug,
    });

    await world.workerTickAfter(0);
    await ticksUntil(4);

    // The healthy log is sent on time, rule by rule.
    expect(world.timesPushed(healthy, atOnce)).toBe(1);
    expect(world.timesPushed(healthy, later)).toBe(1);
    // The failing one sent nothing, waits its turn, and is still paging.
    expect(world.timesPushed(failing, atOnce)).toBe(0);
    expect(world.keptFailures(failing)).toMatchObject({ failedTries: 3 });
    expect(world.statusOf(failing)).toBe(
      UserNotificationExecutionStatus.Executing,
    );
    expect(world.keptFailures(healthy)).toBeNull();
  });

  test("a restart between tries counts on: the tries are kept in Redis, not in the process", async () => {
    world.rule(1, 0);
    const log: UserOnCallLog = world.log(1);
    world.failAt(PersonPageStep.ReadRules, { times: 2 });

    await world.workerTickAfter(0);
    await world.workerTickAfter(1);

    // The worker restarts: a new process, with only what Redis kept.
    expect(world.keptFailures(log)).toMatchObject({ failedTries: 2 });

    await world.workerTickAfter(1);
    expect(world.pushes).toEqual([]);

    await world.workerTickAfter(1);
    expect(world.pushLine()).toEqual(["1 @ 3"]);
  });

  test("a process that stops in the middle of a try is tried again the next minute, and the rule is sent once", async () => {
    const atOnce: UserNotificationRule = world.rule(1, 0);
    const log: UserOnCallLog = world.log(1);
    world.crashAt(PersonPageStep.ReadRules);

    await world.workerTickAfter(0);

    // Nothing it would have written was written.
    expect(world.keptFailures(log)).toBeNull();
    expect(world.pushes).toEqual([]);

    await world.workerTickAfter(1);

    expect(world.timesPushed(log, atOnce)).toBe(1);
  });
});

describe("a Redis that is down", () => {
  test("keeps no tries: a failing log is tried every minute, as before, and nothing throws", async () => {
    world.rule(1, 0);
    const log: UserOnCallLog = world.log(1);
    world.isRedisDown = true;
    world.failAlwaysAt(PersonPageStep.ReadRules, bug);

    await world.workerTickAfter(0);
    await ticksUntil(12);

    expect(world.callsAt(PersonPageStep.ReadRules)).toBe(13);
    expect(world.statusOf(log)).toBe(UserNotificationExecutionStatus.Executing);
  });

  test("a log that recovers is sent once", async () => {
    const atOnce: UserNotificationRule = world.rule(1, 0);
    const log: UserOnCallLog = world.log(1);
    world.isRedisDown = true;
    world.failAt(PersonPageStep.ReadRules, { times: 2 });

    await world.workerTickAfter(0);
    await ticksUntil(4);

    expect(world.timesPushed(log, atOnce)).toBe(1);
    expect(world.pushLine()).toEqual(["1 @ 2"]);
  });
});
