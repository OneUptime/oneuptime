import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../../Server/Services/IncidentService";
import OnCallDutyPolicyExecutionLogService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import UserNotificationRuleService from "../../../../Server/Services/UserNotificationRuleService";
import UserOnCallLogService from "../../../../Server/Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../../../Server/Services/UserOnCallLogTimelineService";
import {
  OnCallPageAgainOutcome,
  OnCallPageAgainResult,
} from "../../../../Server/Utils/OnCall/OnCallAcknowledgementTimeout";
import OnCallDutyPolicyStatus from "../../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import AcknowledgementTimeoutWorld, {
  CREATED,
} from "./AcknowledgementTimeoutWorld";
import { ANA, CARL, DANA, RUN_ID } from "./PassOnWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A PAGE AGAIN WHOSE PROCESS STOPS BETWEEN ITS CLOCK STOP AND ITS START
 * (issue #8549).
 *
 * A page again is claimed by stopping its run's acknowledgement clock;
 * then its run is written, and its start kept in flight until its rule is
 * recorded (#8514). A process that stopped in between - a deploy, an OOM
 * kill - left the clock stopped: with no run there was nobody to page, and
 * a run with no start was handed over from the policy's first level. The
 * person who acknowledged was never reminded.
 *
 * Now each page again is kept in flight from just before its clock stop,
 * and the page-again tick settles one still there two minutes on: a run
 * never written has its clock given back, and is paged again by that very
 * tick; a run written has its start kept, to be started from where it
 * starts. Nobody is paged again twice.
 *
 * Driven through the real clock (OnCallAcknowledgementTimeout) and
 * startPageAgain over AcknowledgementTimeoutWorld, with Redis in memory and
 * a process that stops at a write: from there nothing it writes lands.
 */

type AnyFunction = (...args: Array<any>) => any;

const LEVELS_NAMESPACE: string = "on-call-levels-in-flight";
const PAGES_AGAIN_NAMESPACE: string = "on-call-pages-again-in-flight";

let world: AcknowledgementTimeoutWorld;

// Redis, in memory, outside the process: what it holds outlives a restart.
let kept: Map<string, string>;
// The process stopped: nothing it writes lands, until the next tick.
let stopped: boolean;
// Where the process stops, once: a Redis write it is about to make, the clock stop, or the run's write.
let stopsAtRedis: ((namespace: string, value: string) => boolean) | null;
let stopsAtClockStop: boolean;
let stopsAtRunWrite: boolean;
// Redis cannot be reached at all.
let isRedisDown: boolean;
// A write that fails once, the process going on: the database's next compare-and-set, a Redis write.
let failsCompareAndSetOnce: boolean;
let failsRedisWriteOnce: ((namespace: string) => boolean) | null;

class ProcessStopped extends Error {
  public constructor() {
    super("The process stopped here.");
  }
}

function stop(): never {
  stopped = true;
  throw new ProcessStopped();
}

function failIfStopped(): void {
  if (stopped) {
    throw new ProcessStopped();
  }
}

function failIfRedisCannotBeReached(): void {
  failIfStopped();

  if (isRedisDown) {
    throw new Error("Redis cannot be reached.");
  }
}

// Wraps the world's own answer for a write: nothing lands once the process stopped.
function stopsWith(
  service: unknown,
  method: string,
  before?: () => void,
): void {
  const base: AnyFunction = (
    (service as Record<string, unknown>)[method] as {
      getMockImplementation: () => AnyFunction;
    }
  ).getMockImplementation();

  jest.spyOn(service as never, method as never).mockImplementation((async (
    ...args: Array<unknown>
  ) => {
    failIfStopped();

    if (before) {
      before();
    }

    return await base(...args);
  }) as never);
}

beforeEach(() => {
  world = new AcknowledgementTimeoutWorld();
  world.install();
  world.addRule({ order: 1, users: [ANA] });
  world.addRule({ order: 2, users: [CARL] });

  kept = new Map();
  stopped = false;
  stopsAtRedis = null;
  stopsAtClockStop = false;
  stopsAtRunWrite = false;
  isRedisDown = false;
  failsCompareAndSetOnce = false;
  failsRedisWriteOnce = null;

  jest.spyOn(GlobalCache, "getString").mockImplementation((async (
    namespace: string,
    key: string,
  ) => {
    failIfRedisCannotBeReached();
    return kept.get(`${namespace}-${key}`) || null;
  }) as never);

  jest.spyOn(GlobalCache, "getStrings").mockImplementation((async (
    namespace: string,
    keys: Array<string>,
  ) => {
    failIfRedisCannotBeReached();
    return keys.map((key: string) => {
      return kept.get(`${namespace}-${key}`) || null;
    });
  }) as never);

  jest.spyOn(GlobalCache, "setString").mockImplementation((async (
    namespace: string,
    key: string,
    value: string,
  ) => {
    failIfRedisCannotBeReached();

    if (stopsAtRedis && stopsAtRedis(namespace, value)) {
      stopsAtRedis = null;
      stop();
    }

    if (failsRedisWriteOnce && failsRedisWriteOnce(namespace)) {
      failsRedisWriteOnce = null;
      throw new Error("Cache is not connected");
    }

    kept.set(`${namespace}-${key}`, value);
  }) as never);

  jest.spyOn(GlobalCache, "deleteKey").mockImplementation((async (
    namespace: string,
    key: string,
  ) => {
    failIfRedisCannotBeReached();
    kept.delete(`${namespace}-${key}`);
  }) as never);

  // Every write the world answers: the runs, their steps, the pages and what they lead to.
  stopsWith(
    OnCallDutyPolicyExecutionLogService,
    "compareAndSetColumnsByIdWithoutHooks",
    () => {
      if (stopsAtClockStop) {
        stopsAtClockStop = false;
        stop();
      }

      if (failsCompareAndSetOnce) {
        failsCompareAndSetOnce = false;
        throw new Error("Connection terminated unexpectedly");
      }
    },
  );
  stopsWith(OnCallDutyPolicyExecutionLogService, "create", () => {
    if (stopsAtRunWrite) {
      stopsAtRunWrite = false;
      stop();
    }
  });
  stopsWith(OnCallDutyPolicyExecutionLogService, "updateOneById");
  stopsWith(
    OnCallDutyPolicyExecutionLogService,
    "updateColumnsByIdWithoutHooks",
  );
  stopsWith(OnCallDutyPolicyExecutionLogService, "claimEscalationAdvance");
  stopsWith(OnCallDutyPolicyExecutionLogTimelineService, "create");
  stopsWith(OnCallDutyPolicyExecutionLogTimelineService, "updateOneById");
  stopsWith(UserNotificationRuleService, "startUserNotificationRulesExecution");
  stopsWith(UserOnCallLogService, "updateOneById");
  stopsWith(UserOnCallLogTimelineService, "updateOneBy");
  stopsWith(IncidentService, "acknowledgeIncident");
  stopsWith(IncidentFeedService, "createIncidentFeedItem");
});

afterEach(() => {
  jest.restoreAllMocks();
});

function pagedAgain(
  results: Array<OnCallPageAgainResult>,
): Array<OnCallPageAgainResult> {
  return results.filter((result: OnCallPageAgainResult) => {
    return result.outcome === OnCallPageAgainOutcome.PagedAgain;
  });
}

// A tick of the page-again worker: a process that stopped in it is a fresh one at the next.
async function tick(): Promise<Array<OnCallPageAgainResult>> {
  try {
    return await world.pageAgainTick();
  } finally {
    stopped = false;
  }
}

// Dana acknowledges at 5; the first run ends; the clock runs out at 35.
async function acknowledgedAndLeft(): Promise<void> {
  await world.startRun();

  world.advance(5);
  await world.acknowledgeInDashboard(DANA);

  world.advance(1);
  await world.escalationTick();

  world.advance(29);
}

function pagesAgainInFlight(): Record<string, unknown> {
  const value: string | undefined = kept.get(`${PAGES_AGAIN_NAMESPACE}-claims`);
  return value ? (JSON.parse(value) as Record<string, unknown>) : {};
}

function startKeptFor(
  run: OnCallDutyPolicyExecutionLog,
): Record<string, unknown> | null {
  const value: string | undefined = kept.get(
    `${LEVELS_NAMESPACE}-${run.id!.toString()}`,
  );
  return value ? (JSON.parse(value) as Record<string, unknown>) : null;
}

describe("a process that stops before the page again's run is written", () => {
  test("REGRESSION: the clock is given back two minutes on, and that tick pages again - whoever acknowledged first, once", async () => {
    await acknowledgedAndLeft();
    stopsAtRunWrite = true;

    expect(pagedAgain(await tick())).toEqual([]);

    // The clock is stopped and no run was written; the page again is in flight.
    expect(world.runningClocks()).toEqual([]);
    expect(world.pagesAgain()).toEqual([]);
    expect(Object.keys(pagesAgainInFlight())).toEqual([RUN_ID.toString()]);

    // A minute on, it may still be starting somewhere: left to it.
    world.advance(1);
    expect(pagedAgain(await tick())).toEqual([]);

    world.advance(1);
    const results: Array<OnCallPageAgainResult> = await tick();

    expect(pagedAgain(results)).toHaveLength(1);
    expect(world.pagesAgain()).toHaveLength(1);

    const run: OnCallDutyPolicyExecutionLog = world.runById(
      pagedAgain(results)[0]!.pageAgainRunId!,
    );

    expect(world.pagedIn(run.id!)).toEqual(["Dana Kim", "Ana Lopez"]);
    expect(pagesAgainInFlight()).toEqual({});

    // Nobody is paged again twice.
    world.advance(5);
    expect(pagedAgain(await tick())).toEqual([]);
    expect(world.pagesAgain()).toHaveLength(1);
  });
});

describe("a settle that fails is tried again at the next tick", () => {
  test("a give-back the database fails keeps the page again in flight: given back a minute on, it pages again once", async () => {
    await acknowledgedAndLeft();
    stopsAtRunWrite = true;
    await tick();

    world.advance(2);
    failsCompareAndSetOnce = true;

    expect(pagedAgain(await tick())).toEqual([]);
    expect(world.runningClocks()).toEqual([]);
    expect(Object.keys(pagesAgainInFlight())).toEqual([RUN_ID.toString()]);

    world.advance(1);
    const results: Array<OnCallPageAgainResult> = await tick();

    expect(pagedAgain(results)).toHaveLength(1);
    expect(world.pagedIn(pagedAgain(results)[0]!.pageAgainRunId!)).toEqual([
      "Dana Kim",
      "Ana Lopez",
    ]);
    expect(pagesAgainInFlight()).toEqual({});
  });

  test("a start Redis does not take keeps the page again in flight: kept a minute on, and no second page again", async () => {
    await acknowledgedAndLeft();
    stopsAtRedis = (namespace: string): boolean => {
      return namespace === LEVELS_NAMESPACE;
    };
    await tick();

    const run: OnCallDutyPolicyExecutionLog = world.pagesAgain()[0]!;

    world.advance(2);
    failsRedisWriteOnce = (namespace: string): boolean => {
      return namespace === LEVELS_NAMESPACE;
    };

    expect(pagedAgain(await tick())).toEqual([]);
    expect(startKeptFor(run)).toBeNull();
    expect(Object.keys(pagesAgainInFlight())).toEqual([RUN_ID.toString()]);

    world.advance(1);
    expect(pagedAgain(await tick())).toEqual([]);

    expect(startKeptFor(run)).toMatchObject({
      stopped: true,
      pageAgain: { acknowledgedByUserId: DANA.toString() },
    });
    expect(pagesAgainInFlight()).toEqual({});
    expect(world.pagesAgain()).toHaveLength(1);
  });

  test("a clock an acknowledgement started again in the meantime runs on: nothing is given back over it", async () => {
    await acknowledgedAndLeft();
    stopsAtRunWrite = true;
    await tick();

    // The incident is opened again, and Ana acknowledges it: its clock starts again.
    world.advance(1);
    await world.changeState(CREATED, null);
    await world.acknowledgeInDashboard(ANA);
    const restarted: Array<{ runId: string; startedAt: Date }> =
      world.runningClocks();
    expect(restarted).toHaveLength(1);

    world.advance(1);
    expect(pagedAgain(await tick())).toEqual([]);

    expect(world.runningClocks()).toEqual(restarted);
    expect(pagesAgainInFlight()).toEqual({});
    expect(world.pagesAgain()).toEqual([]);
  });
});

describe("a process that stops as it stops the clock", () => {
  test("the clock it never stopped runs out at the next tick, which pages again - once, and nothing is settled after", async () => {
    await acknowledgedAndLeft();
    stopsAtClockStop = true;

    expect(pagedAgain(await tick())).toEqual([]);
    expect(world.runningClocks()).toHaveLength(1);
    expect(world.pagesAgain()).toEqual([]);

    world.advance(1);
    const results: Array<OnCallPageAgainResult> = await tick();

    expect(pagedAgain(results)).toHaveLength(1);
    expect(world.pagedIn(pagedAgain(results)[0]!.pageAgainRunId!)).toEqual([
      "Dana Kim",
      "Ana Lopez",
    ]);
    expect(pagesAgainInFlight()).toEqual({});

    world.advance(3);
    expect(pagedAgain(await tick())).toEqual([]);
    expect(world.pagesAgain()).toHaveLength(1);
  });
});

describe("a process that stops after the page again's run is written, before its start is kept", () => {
  test("REGRESSION: its start is kept two minutes on, from where it starts and who acknowledged - and no second page again comes", async () => {
    await acknowledgedAndLeft();
    stopsAtRedis = (namespace: string): boolean => {
      return namespace === LEVELS_NAMESPACE;
    };

    expect(pagedAgain(await tick())).toEqual([]);

    expect(world.pagesAgain()).toHaveLength(1);
    const run: OnCallDutyPolicyExecutionLog = world.pagesAgain()[0]!;
    expect(run.status).toBe(OnCallDutyPolicyStatus.Scheduled);
    expect(startKeptFor(run)).toBeNull();

    world.advance(2);
    expect(pagedAgain(await tick())).toEqual([]);

    // Its start is kept: the stuck-run job and the policy-run worker start it from there (#8514).
    expect(startKeptFor(run)).toMatchObject({
      stopped: true,
      firstUserIds: [DANA.toString()],
      pageAgain: {
        acknowledgedByUserId: DANA.toString(),
        minutes: 30,
      },
    });
    expect(world.runningClocks()).toEqual([]);
    expect(world.pagesAgain()).toHaveLength(1);
    expect(pagesAgainInFlight()).toEqual({});
  });

  test("one whose process stopped before it kept the run's id is found by its record and number, and its start kept - no second page again", async () => {
    await acknowledgedAndLeft();
    // The third write of the page again in flight is the one with its run's id.
    stopsAtRedis = (namespace: string, value: string): boolean => {
      return (
        namespace === PAGES_AGAIN_NAMESPACE &&
        value.includes('"pageAgainRunId":"')
      );
    };

    await tick();

    expect(world.pagesAgain()).toHaveLength(1);
    const run: OnCallDutyPolicyExecutionLog = world.pagesAgain()[0]!;

    world.advance(2);
    expect(pagedAgain(await tick())).toEqual([]);

    expect(startKeptFor(run)).toMatchObject({
      pageAgain: { acknowledgedByUserId: DANA.toString() },
    });
    expect(world.runningClocks()).toEqual([]);
    expect(world.pagesAgain()).toHaveLength(1);
  });
});

describe("a page again that starts as it should", () => {
  test("leaves nothing in flight, and is not settled again", async () => {
    await acknowledgedAndLeft();

    const run: OnCallDutyPolicyExecutionLog = world.runById(
      pagedAgain(await tick())[0]!.pageAgainRunId!,
    );

    expect(world.pagedIn(run.id!)).toEqual(["Dana Kim", "Ana Lopez"]);
    expect(pagesAgainInFlight()).toEqual({});

    world.advance(3);
    expect(pagedAgain(await tick())).toEqual([]);
    expect(world.pagesAgain()).toHaveLength(1);
  });

  test("with Redis down, it pages again as before: whoever acknowledged first, once", async () => {
    await acknowledgedAndLeft();
    isRedisDown = true;

    const results: Array<OnCallPageAgainResult> = await tick();

    expect(pagedAgain(results)).toHaveLength(1);
    expect(world.pagedIn(pagedAgain(results)[0]!.pageAgainRunId!)).toEqual([
      "Dana Kim",
      "Ana Lopez",
    ]);

    world.advance(3);
    expect(pagedAgain(await tick())).toEqual([]);
    expect(world.pagesAgain()).toHaveLength(1);
  });

  test("a tick that loses the clock to another forgets what it kept", async () => {
    await acknowledgedAndLeft();
    // Another tick stopped the clock first.
    jest
      .spyOn(
        OnCallDutyPolicyExecutionLogService,
        "stopAcknowledgementTimeoutClock",
      )
      .mockResolvedValue(false as never);

    const results: Array<OnCallPageAgainResult> = await tick();

    expect(
      results.map((result: OnCallPageAgainResult) => {
        return result.outcome;
      }),
    ).toContain(OnCallPageAgainOutcome.TakenElsewhere);
    expect(pagesAgainInFlight()).toEqual({});
  });
});
