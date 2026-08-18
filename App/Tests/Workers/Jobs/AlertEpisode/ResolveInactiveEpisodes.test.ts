import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertGroupingRule from "Common/Models/DatabaseModels/AlertGroupingRule";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";

/*
 * Regression tests for the AlertEpisode:ResolveInactiveEpisodes cron's query
 * fan-out (the line-for-line twin of IncidentEpisode:ResolveInactiveEpisodes -
 * keep the two suites symmetric). The job runs EVERY FIVE MINUTES over up to
 * 1000 active episodes; it used to issue one
 * AlertGroupingRuleService.findOneById PER EPISODE inside an unbounded
 * Promise.allSettled fanout - up to 1000 concurrent point SELECTs per tick for
 * a handful of distinct rules. The perf fix hoists the rule lookups into ONE
 * batched findBy over the distinct rule ids before the episode fan-out. These
 * tests pin:
 *   1. the batch shape: exactly one grouping-rule findBy per tick over the
 *      deduplicated rule ids (skipped entirely when no episode carries a rule
 *      id), and - THE regression being removed - zero findOneById / findOneBy
 *      calls on any of the services,
 *   2. the decision semantics are unchanged: timeout-disabled / zero-timeout /
 *      missing-rule / no-rule-id episodes never resolve, the inactivity
 *      threshold boundary on lastAlertAddedAt (with the createdAt fallback),
 *      the resolveEpisode arguments (no user, cascade to alerts), and the
 *      Promise.allSettled isolation between episodes.
 *
 * The job registers itself via RunCron at import time and exports nothing, so
 * the Cron util is mocked to CAPTURE the handler (the same recorder the other
 * App/Tests/Workers/Jobs suites use) and each test drives one full tick.
 */

type CronHandler = () => Promise<void>;

/*
 * Captured cron handlers, keyed by job name. Must be declared before the job
 * import below so the mock factory closure can see it.
 */
const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

/*
 * findOneById / findOneBy are mocked ALONGSIDE the batched findBy on every
 * service precisely so the suite can prove they are never called: if the job
 * regressed back to per-episode point reads, the assertions would flag it
 * instead of the mock throwing "not a function".
 */
jest.mock("Common/Server/Services/AlertEpisodeService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      resolveEpisode: jest.fn(),
      findOneBy: jest.fn(),
      findOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/AlertGroupingRuleService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      findOneBy: jest.fn(),
      findOneById: jest.fn(),
    },
  };
});

import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import AlertGroupingRuleService from "Common/Server/Services/AlertGroupingRuleService";
import logger from "Common/Server/Utils/Logger";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/AlertEpisode/ResolveInactiveEpisodes";

interface EpisodeServiceMock {
  findBy: jest.Mock;
  resolveEpisode: jest.Mock;
  findOneBy: jest.Mock;
  findOneById: jest.Mock;
}

interface FindByServiceMock {
  findBy: jest.Mock;
  findOneBy: jest.Mock;
  findOneById: jest.Mock;
}

const episodeService: EpisodeServiceMock =
  AlertEpisodeService as unknown as EpisodeServiceMock;
const ruleService: FindByServiceMock =
  AlertGroupingRuleService as unknown as FindByServiceMock;
const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

const NOW: Date = new Date("2026-07-27T10:00:00.000Z");

const PROJECT_1_ID: ObjectID = new ObjectID("project-1");
const RULE_1_ID: ObjectID = new ObjectID("rule-1");
const RULE_2_ID: ObjectID = new ObjectID("rule-2");
const EPISODE_1_ID: ObjectID = new ObjectID("episode-1");
const EPISODE_2_ID: ObjectID = new ObjectID("episode-2");
const EPISODE_3_ID: ObjectID = new ObjectID("episode-3");
const EPISODE_4_ID: ObjectID = new ObjectID("episode-4");
const EPISODE_5_ID: ObjectID = new ObjectID("episode-5");

// The inactivity timeout the enabled rules use, in minutes.
const TIMEOUT_MINUTES: number = 30;

function minutesBeforeNow(minutes: number, extraSeconds?: number): Date {
  return new Date(NOW.getTime() - minutes * 60000 - (extraSeconds || 0) * 1000);
}

function makeEpisode(data: {
  id: ObjectID;
  projectId?: ObjectID | undefined;
  ruleId?: ObjectID | undefined;
  lastAlertAddedAt?: Date | undefined;
  createdAt?: Date | undefined;
}): AlertEpisode {
  const episode: AlertEpisode = new AlertEpisode(data.id);

  if (data.projectId) {
    episode.projectId = data.projectId;
  }

  if (data.ruleId) {
    episode.alertGroupingRuleId = data.ruleId;
  }

  if (data.lastAlertAddedAt) {
    episode.lastAlertAddedAt = data.lastAlertAddedAt;
  }

  if (data.createdAt) {
    episode.createdAt = data.createdAt;
  }

  return episode;
}

function makeRule(data: {
  id: ObjectID;
  enableInactivityTimeout?: boolean | undefined;
  inactivityTimeoutMinutes?: number | undefined;
}): AlertGroupingRule {
  const rule: AlertGroupingRule = new AlertGroupingRule(data.id);
  rule.enableInactivityTimeout = data.enableInactivityTimeout || false;

  if (data.inactivityTimeoutMinutes !== undefined) {
    rule.inactivityTimeoutMinutes = data.inactivityTimeoutMinutes;
  }

  return rule;
}

/*
 * Reads the id list bound into one of QueryHelper.any's Raw predicates
 * (typeorm keeps the bound parameters on the FindOperator).
 */
function boundIdsOf(predicate: unknown): Array<string> {
  const parameters: Record<string, Array<string>> | undefined = (
    predicate as {
      objectLiteralParameters?: Record<string, Array<string>> | undefined;
    }
  ).objectLiteralParameters;

  expect(parameters).toBeDefined();

  const values: Array<Array<string>> = Object.values(parameters!);

  expect(values).toHaveLength(1);

  return values[0]!;
}

interface FindByArgs {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  limit: number;
  skip: number;
}

interface ResolveEpisodeArgs {
  episodeId: ObjectID;
  userId: unknown;
  cascade: unknown;
}

function resolveCalls(): Array<ResolveEpisodeArgs> {
  return episodeService.resolveEpisode.mock.calls.map(
    (args: Array<unknown>) => {
      return {
        episodeId: args[0] as ObjectID,
        userId: args[1],
        cascade: args[2],
      };
    },
  );
}

function resolvedEpisodeIds(): Array<string> {
  return resolveCalls().map((call: ResolveEpisodeArgs) => {
    return call.episodeId.toString();
  });
}

/*
 * THE regression this change removed: per-episode findOneById / findOneBy
 * point reads. Every test asserts none of them ever fire.
 */
function expectNoPerRowLookups(): void {
  expect(episodeService.findOneBy).not.toHaveBeenCalled();
  expect(episodeService.findOneById).not.toHaveBeenCalled();
  expect(ruleService.findOneBy).not.toHaveBeenCalled();
  expect(ruleService.findOneById).not.toHaveBeenCalled();
}

async function runWorkerTick(): Promise<void> {
  const handler: CronHandler | undefined =
    mockCapturedJobs["AlertEpisode:ResolveInactiveEpisodes"];

  if (!handler) {
    throw new Error(
      "AlertEpisode:ResolveInactiveEpisodes did not register a cron handler - the RunCron mock never saw it.",
    );
  }

  await handler();
}

describe("AlertEpisode:ResolveInactiveEpisodes worker", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return new Date(NOW);
    });

    episodeService.findBy.mockResolvedValue([]);
    episodeService.resolveEpisode.mockResolvedValue(undefined);
    ruleService.findBy.mockResolvedValue([]);
  });

  test("batches grouping rules once per tick over the distinct rule ids - never per-episode point reads", async () => {
    // 5 stale episodes sharing exactly TWO distinct grouping rules.
    episodeService.findBy.mockResolvedValue([
      makeEpisode({
        id: EPISODE_1_ID,
        projectId: PROJECT_1_ID,
        ruleId: RULE_1_ID,
        lastAlertAddedAt: minutesBeforeNow(TIMEOUT_MINUTES + 1),
      }),
      makeEpisode({
        id: EPISODE_2_ID,
        projectId: PROJECT_1_ID,
        ruleId: RULE_2_ID,
        lastAlertAddedAt: minutesBeforeNow(TIMEOUT_MINUTES + 1),
      }),
      makeEpisode({
        id: EPISODE_3_ID,
        projectId: PROJECT_1_ID,
        ruleId: RULE_1_ID,
        lastAlertAddedAt: minutesBeforeNow(TIMEOUT_MINUTES + 1),
      }),
      makeEpisode({
        id: EPISODE_4_ID,
        projectId: PROJECT_1_ID,
        ruleId: RULE_2_ID,
        lastAlertAddedAt: minutesBeforeNow(TIMEOUT_MINUTES + 1),
      }),
      makeEpisode({
        id: EPISODE_5_ID,
        projectId: PROJECT_1_ID,
        ruleId: RULE_1_ID,
        lastAlertAddedAt: minutesBeforeNow(TIMEOUT_MINUTES + 1),
      }),
    ]);
    ruleService.findBy.mockResolvedValue([
      makeRule({
        id: RULE_1_ID,
        enableInactivityTimeout: true,
        inactivityTimeoutMinutes: TIMEOUT_MINUTES,
      }),
      makeRule({
        id: RULE_2_ID,
        enableInactivityTimeout: true,
        inactivityTimeoutMinutes: TIMEOUT_MINUTES,
      }),
    ]);

    await runWorkerTick();

    // The episode list itself is still one page of active (unresolved) episodes.
    expect(episodeService.findBy).toHaveBeenCalledTimes(1);

    const episodeArgs: FindByArgs = episodeService.findBy.mock
      .calls[0]![0] as FindByArgs;
    const resolvedAtPredicate: { getSql?: (alias: string) => string } =
      episodeArgs.query["resolvedAt"] as {
        getSql?: (alias: string) => string;
      };

    expect(resolvedAtPredicate.getSql!("resolvedAt")).toBe(
      "(resolvedAt IS NULL)",
    );
    expect(episodeArgs.limit).toBe(1000);
    expect(episodeArgs.skip).toBe(0);

    // ONE grouping-rule batch over exactly the 2 distinct rule ids (deduplicated).
    expect(ruleService.findBy).toHaveBeenCalledTimes(1);

    const ruleArgs: FindByArgs = ruleService.findBy.mock
      .calls[0]![0] as FindByArgs;

    expect(boundIdsOf(ruleArgs.query["_id"])).toEqual([
      RULE_1_ID.toString(),
      RULE_2_ID.toString(),
    ]);
    // _id is needed to key the map; the timeout fields drive the decision.
    expect(ruleArgs.select).toEqual({
      _id: true,
      enableInactivityTimeout: true,
      inactivityTimeoutMinutes: true,
    });
    /*
     * The batch must page wide enough (LIMIT_MAX) for every distinct rule id
     * behind the 1000-episode page — a smaller limit would silently drop
     * rules and leave their episodes treated as rule-less.
     */
    expect(ruleArgs.limit).toBe(10000);
    expect(ruleArgs.skip).toBe(0);

    // The batch completes BEFORE the per-episode fan-out starts resolving.
    expect(ruleService.findBy.mock.invocationCallOrder[0]!).toBeLessThan(
      episodeService.resolveEpisode.mock.invocationCallOrder[0]!,
    );

    // Every stale episode resolves: no user, cascade to member alerts.
    expect(episodeService.resolveEpisode).toHaveBeenCalledTimes(5);

    for (const call of resolveCalls()) {
      expect(call.userId).toBeUndefined();
      expect(call.cascade).toBe(true);
    }

    expectNoPerRowLookups();
  });

  test("timeout disabled, zero timeout, missing rule, and no rule id never resolve - only the enabled stale episode does", async () => {
    const zeroTimeoutRuleId: ObjectID = new ObjectID("rule-zero-timeout");
    const deletedRuleId: ObjectID = new ObjectID("rule-deleted");

    episodeService.findBy.mockResolvedValue([
      // Rule enabled with a real timeout and the episode is stale: resolves.
      makeEpisode({
        id: EPISODE_1_ID,
        projectId: PROJECT_1_ID,
        ruleId: RULE_1_ID,
        lastAlertAddedAt: minutesBeforeNow(TIMEOUT_MINUTES + 1),
      }),
      // Rule exists but the timeout toggle is off: never resolves.
      makeEpisode({
        id: EPISODE_2_ID,
        projectId: PROJECT_1_ID,
        ruleId: RULE_2_ID,
        lastAlertAddedAt: minutesBeforeNow(TIMEOUT_MINUTES + 1),
      }),
      // Rule enabled but with a zero timeout: never resolves.
      makeEpisode({
        id: EPISODE_3_ID,
        projectId: PROJECT_1_ID,
        ruleId: zeroTimeoutRuleId,
        lastAlertAddedAt: minutesBeforeNow(TIMEOUT_MINUTES + 1),
      }),
      // Rule id points at a deleted rule: behaves exactly like no rule.
      makeEpisode({
        id: EPISODE_4_ID,
        projectId: PROJECT_1_ID,
        ruleId: deletedRuleId,
        lastAlertAddedAt: minutesBeforeNow(TIMEOUT_MINUTES + 1),
      }),
      // No rule id at all: never resolves.
      makeEpisode({
        id: EPISODE_5_ID,
        projectId: PROJECT_1_ID,
        lastAlertAddedAt: minutesBeforeNow(TIMEOUT_MINUTES + 1),
      }),
    ]);
    ruleService.findBy.mockResolvedValue([
      makeRule({
        id: RULE_1_ID,
        enableInactivityTimeout: true,
        inactivityTimeoutMinutes: TIMEOUT_MINUTES,
      }),
      makeRule({
        id: RULE_2_ID,
        enableInactivityTimeout: false,
        inactivityTimeoutMinutes: TIMEOUT_MINUTES,
      }),
      makeRule({
        id: zeroTimeoutRuleId,
        enableInactivityTimeout: true,
        inactivityTimeoutMinutes: 0,
      }),
      // The deleted rule is intentionally absent from the batched result.
    ]);

    await runWorkerTick();

    // The deleted rule id was still asked for in the single batch...
    expect(ruleService.findBy).toHaveBeenCalledTimes(1);

    const ruleArgs: FindByArgs = ruleService.findBy.mock
      .calls[0]![0] as FindByArgs;

    expect(boundIdsOf(ruleArgs.query["_id"])).toEqual([
      RULE_1_ID.toString(),
      RULE_2_ID.toString(),
      zeroTimeoutRuleId.toString(),
      deletedRuleId.toString(),
    ]);

    // ...but only the enabled + stale episode resolves.
    expect(resolvedEpisodeIds()).toEqual([EPISODE_1_ID.toString()]);

    expectNoPerRowLookups();
  });

  test("inactivity threshold boundary: exactly at the timeout resolves, one second inside does not", async () => {
    episodeService.findBy.mockResolvedValue([
      // Last alert exactly TIMEOUT_MINUTES ago: minutes-since == timeout, resolve.
      makeEpisode({
        id: EPISODE_1_ID,
        projectId: PROJECT_1_ID,
        ruleId: RULE_1_ID,
        lastAlertAddedAt: minutesBeforeNow(TIMEOUT_MINUTES),
      }),
      // One second short of the timeout: still active, keep waiting.
      makeEpisode({
        id: EPISODE_2_ID,
        projectId: PROJECT_1_ID,
        ruleId: RULE_1_ID,
        lastAlertAddedAt: minutesBeforeNow(TIMEOUT_MINUTES - 1, 59),
      }),
    ]);
    ruleService.findBy.mockResolvedValue([
      makeRule({
        id: RULE_1_ID,
        enableInactivityTimeout: true,
        inactivityTimeoutMinutes: TIMEOUT_MINUTES,
      }),
    ]);

    await runWorkerTick();

    expect(resolvedEpisodeIds()).toEqual([EPISODE_1_ID.toString()]);

    expectNoPerRowLookups();
  });

  test("falls back to createdAt when lastAlertAddedAt is unset", async () => {
    episodeService.findBy.mockResolvedValue([
      // Created past the timeout, never received an alert: resolves.
      makeEpisode({
        id: EPISODE_1_ID,
        projectId: PROJECT_1_ID,
        ruleId: RULE_1_ID,
        createdAt: minutesBeforeNow(TIMEOUT_MINUTES + 1),
      }),
      // Created inside the timeout window: still active.
      makeEpisode({
        id: EPISODE_2_ID,
        projectId: PROJECT_1_ID,
        ruleId: RULE_1_ID,
        createdAt: minutesBeforeNow(1),
      }),
    ]);
    ruleService.findBy.mockResolvedValue([
      makeRule({
        id: RULE_1_ID,
        enableInactivityTimeout: true,
        inactivityTimeoutMinutes: TIMEOUT_MINUTES,
      }),
    ]);

    await runWorkerTick();

    expect(resolvedEpisodeIds()).toEqual([EPISODE_1_ID.toString()]);

    expectNoPerRowLookups();
  });

  test("a tick with zero active episodes issues NO rule query at all", async () => {
    episodeService.findBy.mockResolvedValue([]);

    await runWorkerTick();

    expect(ruleService.findBy).not.toHaveBeenCalled();
    expect(episodeService.resolveEpisode).not.toHaveBeenCalled();

    expectNoPerRowLookups();
  });

  test("episodes without any grouping rule id skip the rule batch entirely and never resolve", async () => {
    episodeService.findBy.mockResolvedValue([
      makeEpisode({
        id: EPISODE_1_ID,
        projectId: PROJECT_1_ID,
        lastAlertAddedAt: minutesBeforeNow(TIMEOUT_MINUTES + 1),
      }),
      makeEpisode({
        id: EPISODE_2_ID,
        projectId: PROJECT_1_ID,
        lastAlertAddedAt: minutesBeforeNow(TIMEOUT_MINUTES + 1),
      }),
    ]);

    await runWorkerTick();

    // No episode carries a rule id, so there is nothing to batch-fetch.
    expect(ruleService.findBy).not.toHaveBeenCalled();
    // Without a rule the timeout stays disabled, so nothing resolves.
    expect(episodeService.resolveEpisode).not.toHaveBeenCalled();

    expectNoPerRowLookups();
  });

  test("one episode's resolve failure does not prevent the other episodes from resolving", async () => {
    episodeService.findBy.mockResolvedValue([
      makeEpisode({
        id: EPISODE_1_ID,
        projectId: PROJECT_1_ID,
        ruleId: RULE_1_ID,
        lastAlertAddedAt: minutesBeforeNow(TIMEOUT_MINUTES + 1),
      }),
      makeEpisode({
        id: EPISODE_2_ID,
        projectId: PROJECT_1_ID,
        ruleId: RULE_1_ID,
        lastAlertAddedAt: minutesBeforeNow(TIMEOUT_MINUTES + 1),
      }),
    ]);
    ruleService.findBy.mockResolvedValue([
      makeRule({
        id: RULE_1_ID,
        enableInactivityTimeout: true,
        inactivityTimeoutMinutes: TIMEOUT_MINUTES,
      }),
    ]);

    episodeService.resolveEpisode.mockImplementation((episodeId: ObjectID) => {
      if (episodeId.toString() === EPISODE_1_ID.toString()) {
        return Promise.reject(new Error("db connection reset"));
      }
      return Promise.resolve(undefined);
    });

    // The tick itself must not reject (Promise.allSettled + per-episode catch).
    await expect(runWorkerTick()).resolves.toBeUndefined();

    // BOTH resolves were attempted; the failure only logged.
    expect(resolvedEpisodeIds()).toEqual([
      EPISODE_1_ID.toString(),
      EPISODE_2_ID.toString(),
    ]);
    expect(mockedLogger.error).toHaveBeenCalled();

    expectNoPerRowLookups();
  });

  test("a failed batched rule fetch aborts the whole tick and only logs - retried next tick", async () => {
    episodeService.findBy.mockResolvedValue([
      makeEpisode({
        id: EPISODE_1_ID,
        projectId: PROJECT_1_ID,
        ruleId: RULE_1_ID,
        lastAlertAddedAt: minutesBeforeNow(TIMEOUT_MINUTES + 1),
      }),
    ]);
    ruleService.findBy.mockRejectedValue(new Error("db connection reset"));

    await expect(runWorkerTick()).resolves.toBeUndefined();

    expect(episodeService.resolveEpisode).not.toHaveBeenCalled();
    expect(mockedLogger.error).toHaveBeenCalled();

    expectNoPerRowLookups();
  });
});
