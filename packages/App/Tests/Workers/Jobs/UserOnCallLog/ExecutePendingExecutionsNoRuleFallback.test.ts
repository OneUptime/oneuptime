import UserOnCallLog from "Common/Models/DatabaseModels/UserOnCallLog";
import UserPush from "Common/Models/DatabaseModels/UserPush";
import ObjectID from "Common/Types/ObjectID";
import PushDeviceType from "Common/Types/PushNotification/PushDeviceType";
import UserNotificationExecutionStatus from "Common/Types/UserNotification/UserNotificationExecutionStatus";
import RunCron from "../../../../FeatureSet/Workers/Utils/Cron";
import "../../../../FeatureSet/Workers/Jobs/UserOnCallLog/ExecutePendingExecutions";
import "../../../../FeatureSet/Workers/Jobs/UserOnCallLog/TimeoutStuckExecutions";
import PersonPageFailureWorld, {
  PERSON_ID,
  PersonPageStep,
  Push,
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
 * A PERSON WITH NO RULE FOR A PAGE IS STILL PAGED BY THEIR VERIFIED
 * METHODS, THROUGH A DATABASE ERROR OR A RESTART (issues #8469, #8470).
 *
 * A log's start pages a person with no On-Call Rule for the page through
 * their verified methods (the fallback, executeFallbackNotification). It
 * claims the log under "__fallback__" first. A database error after the
 * claim - reading whether the person is a member, or their methods - ended
 * the log in Error, and the person was paged by nothing (#8469). A start
 * that stopped before it counted the person's rules was handed to the
 * person's-log worker, which has no fallback: it found no rules, and
 * completed the log having sent nothing (#8470).
 *
 * Now a fallback that fails before anything of it reached a sender gives
 * its claim back and the log goes to the worker, which runs the start's
 * no-rule handling for a log that never sent anything - trying a fallback
 * that keeps failing a few times before it ends it, as the start would
 * have. Nobody is paged twice.
 *
 * Driven through the real log start, the person's-log jobs and the real
 * fallback, down to the push sender, over PersonPageFailureWorld.
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
let log: UserOnCallLog;

beforeEach(() => {
  world = new PersonPageFailureWorld();
  world.install();
  world.useTicks({ worker: workerTick, stuckJob: stuckJobTick });

  // No rule of the person's matches; their one verified method is a phone.
  const phone: UserPush = new UserPush();
  phone.id = new ObjectID("84690000-0000-4000-8000-000000000001");
  phone.userId = PERSON_ID;
  phone.deviceToken = "ExponentPushToken[fallback-phone]";
  phone.deviceType = PushDeviceType.iOS;
  phone.isVerified = true;
  world.fallbackDevice = phone;

  log = world.log(1, { status: UserNotificationExecutionStatus.Scheduled });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The pushes the fallback sent: it pages through rules it never saves.
function fallbackPushes(): Array<number> {
  return world.pushes
    .filter((push: Push) => {
      return push.ruleId === "";
    })
    .map((push: Push): number => {
      return push.minute;
    });
}

// The second read of whether the person is a member: the fallback's own, after the start's.
function theFallbacksMembershipRead(): boolean {
  return world.callsAt(PersonPageStep.ReadMembership) === 2;
}

function errorsWritten(): number {
  return world.statusWrites.filter((write: { status: string }) => {
    return write.status === UserNotificationExecutionStatus.Error;
  }).length;
}

async function ticksUntil(minute: number): Promise<void> {
  while (world.minutesSinceStart() < minute) {
    await world.workerTickAfter(1);
  }
}

describe("a fallback that fails before it sent anything (#8469)", () => {
  test("REGRESSION: its membership read failing as the log starts: the log goes to the worker, and the person is paged the next minute, once", async () => {
    world.failAt(PersonPageStep.ReadMembership, {
      when: theFallbacksMembershipRead,
    });

    await world.startLog(log);

    // Not ended in Error, nothing sent, and nothing left claimed.
    expect(errorsWritten()).toBe(0);
    expect(world.statusOf(log)).toBe(UserNotificationExecutionStatus.Executing);
    expect(world.claimsOn(log)).toEqual([]);
    expect(fallbackPushes()).toEqual([]);

    await world.workerTickAfter(1);

    expect(fallbackPushes()).toEqual([1]);
    expect(world.statusMessageOf(log)).toContain("Sev1");

    await ticksUntil(4);

    // Sent once, and done.
    expect(fallbackPushes()).toEqual([1]);
    expect(world.statusOf(log)).toBe(UserNotificationExecutionStatus.Completed);
    expect(errorsWritten()).toBe(0);
  });

  test("its read of the person's methods failing as the log starts: the same, paged the next minute, once", async () => {
    world.failAt(PersonPageStep.ReadFallbackMethods);

    await world.startLog(log);
    await ticksUntil(3);

    expect(fallbackPushes()).toEqual([1]);
    expect(errorsWritten()).toBe(0);
  });

  test("a fallback that keeps failing is tried at the worker's tries, and ends in Error at the last, saying so and alerting - not every minute, forever", async () => {
    world.failAlwaysAt(PersonPageStep.ReadFallbackMethods);

    await world.startLog(log);
    await ticksUntil(60);

    // The start's try, then the worker's ten, waiting longer each time.
    expect(world.callsAt(PersonPageStep.ReadFallbackMethods)).toBe(11);
    expect(world.statusOf(log)).toBe(UserNotificationExecutionStatus.Error);
    expect(errorsWritten()).toBe(1);
    expect(world.undeliverableAlerts).toBe(1);
    expect(fallbackPushes()).toEqual([]);
  });

  test("a worker that stops after the fallback's claim, before it sent anything: its claim is given back two minutes on, and the person is paged once", async () => {
    world.failAt(PersonPageStep.ReadMembership, {
      when: theFallbacksMembershipRead,
    });
    await world.startLog(log);

    // The worker's fallback at 1 claims, then its process stops.
    world.crashAt(PersonPageStep.ReadFallbackMethods);
    await world.workerTickAfter(1);

    expect(world.claimsOn(log)).toEqual(["__fallback__"]);
    expect(fallbackPushes()).toEqual([]);

    // At 2 its page may still be on its way: left alone, and the log not ended.
    await world.workerTickAfter(1);

    expect(fallbackPushes()).toEqual([]);
    expect(world.statusOf(log)).toBe(UserNotificationExecutionStatus.Executing);

    await world.workerTickAfter(1);

    expect(fallbackPushes()).toEqual([3]);

    await ticksUntil(6);

    expect(fallbackPushes()).toEqual([3]);
  });

  test("an incident acknowledged before the worker's try is not paged about", async () => {
    world.failAt(PersonPageStep.ReadMembership, {
      when: theFallbacksMembershipRead,
    });
    await world.startLog(log);

    world.isIncidentAcknowledged = true;
    await world.workerTickAfter(1);

    expect(fallbackPushes()).toEqual([]);
    expect(world.statusOf(log)).toBe(UserNotificationExecutionStatus.Completed);
  });
});

describe("a log whose start stopped before it counted the person's rules (#8470)", () => {
  test("REGRESSION: handed over five minutes on, the worker pages the person by their verified methods, once - not completed having sent nothing", async () => {
    // The start's first read - the incident's severity - is where its process stops.
    world.crashAt(PersonPageStep.ReadIncident);

    await world.startLog(log).catch(() => {
      return undefined;
    });

    expect(world.statusOf(log)).toBe(UserNotificationExecutionStatus.Started);

    for (let minute: number = 1; minute <= 8; minute++) {
      await world.minutePasses();
    }

    expect(fallbackPushes()).toEqual([5]);
    expect(errorsWritten()).toBe(0);
    expect(world.statusOf(log)).toBe(UserNotificationExecutionStatus.Completed);
  });

  test("a log left Scheduled - its start never ran - is paged by the fallback once handed over", async () => {
    for (let minute: number = 1; minute <= 7; minute++) {
      await world.minutePasses();
    }

    expect(fallbackPushes()).toEqual([5]);
  });
});

describe("a log whose fallback went out", () => {
  test("completes, and nobody is paged twice", async () => {
    await world.startLog(log);

    expect(fallbackPushes()).toEqual([0]);

    for (let minute: number = 1; minute <= 6; minute++) {
      await world.minutePasses();
    }

    expect(fallbackPushes()).toEqual([0]);
    expect(world.statusOf(log)).toBe(UserNotificationExecutionStatus.Completed);
  });
});
