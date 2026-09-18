import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentGroupingRule from "Common/Models/DatabaseModels/IncidentGroupingRule";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";

/*
 * Regression tests for the IncidentEpisode:AutoResolve cron's query fan-out.
 * The job runs EVERY MINUTE over up to 1000 active episodes; it used to issue,
 * per episode, an IncidentGroupingRuleService.findOneById, an
 * IncidentStateService.findOneBy, and one IncidentService.findOneById PER
 * MEMBER incident - O(episodes * members) point reads per tick. The perf fix
 * hoists the rule and resolved-state lookups into ONE batched findBy each
 * (over the distinct rule ids / project ids) before the episode fan-out, and
 * collapses the per-incident loop into one QueryHelper.any(...) findBy per
 * episode. These tests pin:
 *   1. the batch shape: exactly one grouping-rule findBy and one
 *      incident-state findBy per tick, one incident findBy per episode, and -
 *      THE regression being removed - zero findOneById / findOneBy calls on
 *      any of the services,
 *   2. the decision semantics are unchanged: resolved-order comparison,
 *      allIncidentsResolvedAt stamping/clearing, resolve-delay handling,
 *      deleted-member skipping, missing-resolved-state skipping, and the
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
 * regressed back to per-episode (or per-incident) point reads, the assertions
 * would flag it instead of the mock throwing "not a function".
 */
jest.mock("Common/Server/Services/IncidentEpisodeService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      updateOneById: jest.fn(),
      resolveEpisode: jest.fn(),
      findOneBy: jest.fn(),
      findOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentEpisodeMemberService", () => {
  return {
    __esModule: true,
    default: {
      getIncidentsInEpisode: jest.fn(),
      findOneBy: jest.fn(),
      findOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentStateService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      findOneBy: jest.fn(),
      findOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentGroupingRuleService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      findOneBy: jest.fn(),
      findOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      findOneBy: jest.fn(),
      findOneById: jest.fn(),
    },
  };
});

import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import IncidentEpisodeMemberService from "Common/Server/Services/IncidentEpisodeMemberService";
import IncidentGroupingRuleService from "Common/Server/Services/IncidentGroupingRuleService";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentStateService from "Common/Server/Services/IncidentStateService";
import logger from "Common/Server/Utils/Logger";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/IncidentEpisode/AutoResolve";

interface EpisodeServiceMock {
  findBy: jest.Mock;
  updateOneById: jest.Mock;
  resolveEpisode: jest.Mock;
  findOneBy: jest.Mock;
  findOneById: jest.Mock;
}

interface MemberServiceMock {
  getIncidentsInEpisode: jest.Mock;
  findOneBy: jest.Mock;
  findOneById: jest.Mock;
}

interface FindByServiceMock {
  findBy: jest.Mock;
  findOneBy: jest.Mock;
  findOneById: jest.Mock;
}

const episodeService: EpisodeServiceMock =
  IncidentEpisodeService as unknown as EpisodeServiceMock;
const memberService: MemberServiceMock =
  IncidentEpisodeMemberService as unknown as MemberServiceMock;
const stateService: FindByServiceMock =
  IncidentStateService as unknown as FindByServiceMock;
const ruleService: FindByServiceMock =
  IncidentGroupingRuleService as unknown as FindByServiceMock;
const incidentService: FindByServiceMock =
  IncidentService as unknown as FindByServiceMock;
const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

const NOW: Date = new Date("2026-07-27T10:00:00.000Z");

const PROJECT_1_ID: ObjectID = new ObjectID("project-1");
const PROJECT_2_ID: ObjectID = new ObjectID("project-2");
const RULE_1_ID: ObjectID = new ObjectID("rule-1");
const EPISODE_1_ID: ObjectID = new ObjectID("episode-1");
const EPISODE_2_ID: ObjectID = new ObjectID("episode-2");
const EPISODE_3_ID: ObjectID = new ObjectID("episode-3");

// The resolved state's position in the project's state order.
const RESOLVED_ORDER: number = 3;

function makeEpisode(data: {
  id: ObjectID;
  projectId: ObjectID;
  ruleId?: ObjectID | undefined;
  allIncidentsResolvedAt?: Date | undefined;
}): IncidentEpisode {
  const episode: IncidentEpisode = new IncidentEpisode(data.id);
  episode.projectId = data.projectId;

  if (data.ruleId) {
    episode.incidentGroupingRuleId = data.ruleId;
  }

  if (data.allIncidentsResolvedAt) {
    episode.allIncidentsResolvedAt = data.allIncidentsResolvedAt;
  }

  return episode;
}

function makeResolvedState(projectId: ObjectID): IncidentState {
  const state: IncidentState = new IncidentState();
  state.projectId = projectId;
  state.order = RESOLVED_ORDER;
  state.isResolvedState = true;
  return state;
}

function makeRule(data: {
  id: ObjectID;
  enableResolveDelay?: boolean | undefined;
  resolveDelayMinutes?: number | undefined;
}): IncidentGroupingRule {
  const rule: IncidentGroupingRule = new IncidentGroupingRule(data.id);
  rule.enableResolveDelay = data.enableResolveDelay || false;

  if (data.resolveDelayMinutes !== undefined) {
    rule.resolveDelayMinutes = data.resolveDelayMinutes;
  }

  return rule;
}

function makeIncident(id: ObjectID, stateOrder: number): Incident {
  const incident: Incident = new Incident(id);
  const state: IncidentState = new IncidentState();
  state.order = stateOrder;
  incident.currentIncidentState = state;
  return incident;
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
  limit: number;
  skip: number;
}

// The ids each IncidentService.findBy call was constrained to, in call order.
function incidentBatchIds(): Array<Array<string>> {
  return incidentService.findBy.mock.calls.map((args: Array<unknown>) => {
    return boundIdsOf((args[0] as FindByArgs).query["_id"]);
  });
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

interface UpdateCallArgs {
  id: ObjectID;
  data: Record<string, unknown>;
}

function updateCalls(): Array<UpdateCallArgs> {
  return episodeService.updateOneById.mock.calls.map((args: Array<unknown>) => {
    return args[0] as UpdateCallArgs;
  });
}

/*
 * THE regression this change removed: per-episode findOneById / findOneBy
 * point reads. Every test asserts none of them ever fire.
 */
function expectNoPerRowLookups(): void {
  expect(episodeService.findOneBy).not.toHaveBeenCalled();
  expect(episodeService.findOneById).not.toHaveBeenCalled();
  expect(memberService.findOneBy).not.toHaveBeenCalled();
  expect(memberService.findOneById).not.toHaveBeenCalled();
  expect(ruleService.findOneBy).not.toHaveBeenCalled();
  expect(ruleService.findOneById).not.toHaveBeenCalled();
  expect(stateService.findOneBy).not.toHaveBeenCalled();
  expect(stateService.findOneById).not.toHaveBeenCalled();
  expect(incidentService.findOneBy).not.toHaveBeenCalled();
  expect(incidentService.findOneById).not.toHaveBeenCalled();
}

function stubMembers(
  membersByEpisodeId: Record<string, Array<ObjectID>>,
): void {
  memberService.getIncidentsInEpisode.mockImplementation(
    (episodeId: ObjectID) => {
      return Promise.resolve(membersByEpisodeId[episodeId.toString()] || []);
    },
  );
}

function stubIncidents(incidents: Array<Incident>): void {
  const incidentsById: Record<string, Incident> = {};

  for (const incident of incidents) {
    incidentsById[incident.id!.toString()] = incident;
  }

  // Return exactly the requested ids that exist - deleted ids don't come back.
  incidentService.findBy.mockImplementation((args: FindByArgs) => {
    const requestedIds: Array<string> = boundIdsOf(args.query["_id"]);

    return Promise.resolve(
      requestedIds
        .map((id: string) => {
          return incidentsById[id];
        })
        .filter((incident: Incident | undefined) => {
          return Boolean(incident);
        }),
    );
  });
}

async function runWorkerTick(): Promise<void> {
  const handler: CronHandler | undefined =
    mockCapturedJobs["IncidentEpisode:AutoResolve"];

  if (!handler) {
    throw new Error(
      "IncidentEpisode:AutoResolve did not register a cron handler - the RunCron mock never saw it.",
    );
  }

  await handler();
}

describe("IncidentEpisode:AutoResolve worker", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return new Date(NOW);
    });

    episodeService.findBy.mockResolvedValue([]);
    episodeService.updateOneById.mockResolvedValue(undefined);
    episodeService.resolveEpisode.mockResolvedValue(undefined);
    memberService.getIncidentsInEpisode.mockResolvedValue([]);
    stateService.findBy.mockResolvedValue([]);
    ruleService.findBy.mockResolvedValue([]);
    incidentService.findBy.mockResolvedValue([]);
  });

  test("batches grouping rules and resolved states once per tick and incidents once per episode - never per-row point reads", async () => {
    const incident1Id: ObjectID = new ObjectID("incident-1");
    const incident2Id: ObjectID = new ObjectID("incident-2");
    const incident3Id: ObjectID = new ObjectID("incident-3");
    const incident4Id: ObjectID = new ObjectID("incident-4");

    // 3 episodes across 2 projects, all sharing ONE grouping rule.
    episodeService.findBy.mockResolvedValue([
      makeEpisode({
        id: EPISODE_1_ID,
        projectId: PROJECT_1_ID,
        ruleId: RULE_1_ID,
      }),
      makeEpisode({
        id: EPISODE_2_ID,
        projectId: PROJECT_1_ID,
        ruleId: RULE_1_ID,
      }),
      makeEpisode({
        id: EPISODE_3_ID,
        projectId: PROJECT_2_ID,
        ruleId: RULE_1_ID,
      }),
    ]);

    ruleService.findBy.mockResolvedValue([makeRule({ id: RULE_1_ID })]);
    stateService.findBy.mockResolvedValue([
      makeResolvedState(PROJECT_1_ID),
      makeResolvedState(PROJECT_2_ID),
    ]);

    stubMembers({
      [EPISODE_1_ID.toString()]: [incident1Id],
      [EPISODE_2_ID.toString()]: [incident2Id, incident3Id],
      [EPISODE_3_ID.toString()]: [incident4Id],
    });
    stubIncidents([
      makeIncident(incident1Id, RESOLVED_ORDER),
      makeIncident(incident2Id, RESOLVED_ORDER),
      makeIncident(incident3Id, RESOLVED_ORDER + 1),
      makeIncident(incident4Id, RESOLVED_ORDER),
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

    // ONE grouping-rule batch over the distinct rule ids (deduplicated).
    expect(ruleService.findBy).toHaveBeenCalledTimes(1);

    const ruleArgs: FindByArgs = ruleService.findBy.mock
      .calls[0]![0] as FindByArgs;

    expect(boundIdsOf(ruleArgs.query["_id"])).toEqual([RULE_1_ID.toString()]);

    // ONE resolved-state batch over the distinct project ids (deduplicated).
    expect(stateService.findBy).toHaveBeenCalledTimes(1);

    const stateArgs: FindByArgs = stateService.findBy.mock
      .calls[0]![0] as FindByArgs;

    expect(boundIdsOf(stateArgs.query["projectId"])).toEqual([
      PROJECT_1_ID.toString(),
      PROJECT_2_ID.toString(),
    ]);
    expect(stateArgs.query["isResolvedState"]).toBe(true);

    // Both batches complete BEFORE the per-episode fan-out starts.
    expect(ruleService.findBy.mock.invocationCallOrder[0]!).toBeLessThan(
      stateService.findBy.mock.invocationCallOrder[0]!,
    );
    expect(stateService.findBy.mock.invocationCallOrder[0]!).toBeLessThan(
      incidentService.findBy.mock.invocationCallOrder[0]!,
    );

    // ONE incident batch per episode, each over that episode's member ids.
    expect(incidentService.findBy).toHaveBeenCalledTimes(3);
    expect(incidentBatchIds()).toEqual([
      [incident1Id.toString()],
      [incident2Id.toString(), incident3Id.toString()],
      [incident4Id.toString()],
    ]);

    // All members resolved everywhere, so every episode resolves.
    expect(episodeService.resolveEpisode).toHaveBeenCalledTimes(3);

    expectNoPerRowLookups();
  });

  test("resolves an episode whose members are all at or above the resolved order, stamping allIncidentsResolvedAt first", async () => {
    const incident1Id: ObjectID = new ObjectID("incident-1");
    const incident2Id: ObjectID = new ObjectID("incident-2");

    episodeService.findBy.mockResolvedValue([
      makeEpisode({ id: EPISODE_1_ID, projectId: PROJECT_1_ID }),
    ]);
    stateService.findBy.mockResolvedValue([makeResolvedState(PROJECT_1_ID)]);
    stubMembers({
      [EPISODE_1_ID.toString()]: [incident1Id, incident2Id],
    });
    stubIncidents([
      makeIncident(incident1Id, RESOLVED_ORDER),
      makeIncident(incident2Id, RESOLVED_ORDER + 2),
    ]);

    await runWorkerTick();

    // No delay configured: the stamp and the resolve happen in the same tick.
    const stamps: Array<UpdateCallArgs> = updateCalls();

    expect(stamps).toHaveLength(1);
    expect(stamps[0]!.id.toString()).toBe(EPISODE_1_ID.toString());
    expect((stamps[0]!.data["allIncidentsResolvedAt"] as Date).getTime()).toBe(
      NOW.getTime(),
    );

    // Auto-resolve: no user, no cascade (members are already resolved).
    const resolves: Array<ResolveEpisodeArgs> = resolveCalls();

    expect(resolves).toHaveLength(1);
    expect(resolves[0]!.episodeId.toString()).toBe(EPISODE_1_ID.toString());
    expect(resolves[0]!.userId).toBeUndefined();
    expect(resolves[0]!.cascade).toBe(false);

    expectNoPerRowLookups();
  });

  test("does not resolve when one member is below the resolved order, clearing the stamp only when it was set", async () => {
    const incident1Id: ObjectID = new ObjectID("incident-1");
    const incident2Id: ObjectID = new ObjectID("incident-2");

    episodeService.findBy.mockResolvedValue([
      // Previously stamped all-resolved, now regressed: stamp must be cleared.
      makeEpisode({
        id: EPISODE_1_ID,
        projectId: PROJECT_1_ID,
        allIncidentsResolvedAt: new Date("2026-07-27T09:00:00.000Z"),
      }),
      // Never stamped: nothing to clear, so no write at all.
      makeEpisode({ id: EPISODE_2_ID, projectId: PROJECT_1_ID }),
    ]);
    stateService.findBy.mockResolvedValue([makeResolvedState(PROJECT_1_ID)]);
    stubMembers({
      [EPISODE_1_ID.toString()]: [incident1Id],
      [EPISODE_2_ID.toString()]: [incident2Id],
    });
    stubIncidents([
      makeIncident(incident1Id, RESOLVED_ORDER - 1),
      makeIncident(incident2Id, RESOLVED_ORDER - 1),
    ]);

    await runWorkerTick();

    expect(episodeService.resolveEpisode).not.toHaveBeenCalled();

    const clears: Array<UpdateCallArgs> = updateCalls();

    expect(clears).toHaveLength(1);
    expect(clears[0]!.id.toString()).toBe(EPISODE_1_ID.toString());
    expect(clears[0]!.data["allIncidentsResolvedAt"]).toBeNull();

    expectNoPerRowLookups();
  });

  test("members missing from the batched result (deleted incidents) are skipped - surviving resolved members still resolve the episode", async () => {
    const survivingId: ObjectID = new ObjectID("incident-1");
    const deletedId: ObjectID = new ObjectID("incident-gone");

    episodeService.findBy.mockResolvedValue([
      makeEpisode({ id: EPISODE_1_ID, projectId: PROJECT_1_ID }),
    ]);
    stateService.findBy.mockResolvedValue([makeResolvedState(PROJECT_1_ID)]);
    stubMembers({
      [EPISODE_1_ID.toString()]: [survivingId, deletedId],
    });
    // Only the surviving member comes back from the batched query.
    stubIncidents([makeIncident(survivingId, RESOLVED_ORDER)]);

    await runWorkerTick();

    // The deleted id was still asked for in the single batch...
    expect(incidentBatchIds()).toEqual([
      [survivingId.toString(), deletedId.toString()],
    ]);

    // ...but its absence does not block the resolve.
    expect(episodeService.resolveEpisode).toHaveBeenCalledTimes(1);

    expectNoPerRowLookups();
  });

  test("an episode whose project has no resolved state is skipped without resolving, updating, or fetching incidents", async () => {
    const incident1Id: ObjectID = new ObjectID("incident-1");

    episodeService.findBy.mockResolvedValue([
      makeEpisode({ id: EPISODE_1_ID, projectId: PROJECT_2_ID }),
    ]);
    // The batched state query only found a resolved state for ANOTHER project.
    stateService.findBy.mockResolvedValue([makeResolvedState(PROJECT_1_ID)]);
    stubMembers({
      [EPISODE_1_ID.toString()]: [incident1Id],
    });

    await runWorkerTick();

    expect(episodeService.resolveEpisode).not.toHaveBeenCalled();
    expect(episodeService.updateOneById).not.toHaveBeenCalled();
    // The state gate sits before the incident fetch, so no incident batch runs.
    expect(incidentService.findBy).not.toHaveBeenCalled();

    expectNoPerRowLookups();
  });

  test("episodes without a grouping rule skip the rule batch entirely and still resolve", async () => {
    const incident1Id: ObjectID = new ObjectID("incident-1");

    episodeService.findBy.mockResolvedValue([
      makeEpisode({ id: EPISODE_1_ID, projectId: PROJECT_1_ID }),
    ]);
    stateService.findBy.mockResolvedValue([makeResolvedState(PROJECT_1_ID)]);
    stubMembers({
      [EPISODE_1_ID.toString()]: [incident1Id],
    });
    stubIncidents([makeIncident(incident1Id, RESOLVED_ORDER)]);

    await runWorkerTick();

    // No episode carries a rule id, so there is nothing to batch-fetch.
    expect(ruleService.findBy).not.toHaveBeenCalled();
    expect(episodeService.resolveEpisode).toHaveBeenCalledTimes(1);

    expectNoPerRowLookups();
  });

  test("resolve delay: first all-resolved tick stamps without resolving, a stale stamp resolves, a fresh stamp keeps waiting", async () => {
    const incident1Id: ObjectID = new ObjectID("incident-1");
    const incident2Id: ObjectID = new ObjectID("incident-2");
    const incident3Id: ObjectID = new ObjectID("incident-3");

    episodeService.findBy.mockResolvedValue([
      // First tick with everything resolved: stamp now, wait for the delay.
      makeEpisode({
        id: EPISODE_1_ID,
        projectId: PROJECT_1_ID,
        ruleId: RULE_1_ID,
      }),
      // Stamped 31 minutes ago: the 30-minute delay has passed, so resolve.
      makeEpisode({
        id: EPISODE_2_ID,
        projectId: PROJECT_1_ID,
        ruleId: RULE_1_ID,
        allIncidentsResolvedAt: new Date("2026-07-27T09:29:00.000Z"),
      }),
      // Stamped 10 minutes ago: still inside the delay window, keep waiting.
      makeEpisode({
        id: EPISODE_3_ID,
        projectId: PROJECT_1_ID,
        ruleId: RULE_1_ID,
        allIncidentsResolvedAt: new Date("2026-07-27T09:50:00.000Z"),
      }),
    ]);
    ruleService.findBy.mockResolvedValue([
      makeRule({
        id: RULE_1_ID,
        enableResolveDelay: true,
        resolveDelayMinutes: 30,
      }),
    ]);
    stateService.findBy.mockResolvedValue([makeResolvedState(PROJECT_1_ID)]);
    stubMembers({
      [EPISODE_1_ID.toString()]: [incident1Id],
      [EPISODE_2_ID.toString()]: [incident2Id],
      [EPISODE_3_ID.toString()]: [incident3Id],
    });
    stubIncidents([
      makeIncident(incident1Id, RESOLVED_ORDER),
      makeIncident(incident2Id, RESOLVED_ORDER),
      makeIncident(incident3Id, RESOLVED_ORDER),
    ]);

    await runWorkerTick();

    // Only the never-stamped episode gets the stamp write.
    const stamps: Array<UpdateCallArgs> = updateCalls();

    expect(stamps).toHaveLength(1);
    expect(stamps[0]!.id.toString()).toBe(EPISODE_1_ID.toString());
    expect((stamps[0]!.data["allIncidentsResolvedAt"] as Date).getTime()).toBe(
      NOW.getTime(),
    );

    // Only the stale-stamped episode resolves this tick.
    const resolves: Array<ResolveEpisodeArgs> = resolveCalls();

    expect(resolves).toHaveLength(1);
    expect(resolves[0]!.episodeId.toString()).toBe(EPISODE_2_ID.toString());

    expectNoPerRowLookups();
  });

  test("a tick with zero active episodes issues NO batched queries at all", async () => {
    episodeService.findBy.mockResolvedValue([]);

    await runWorkerTick();

    expect(ruleService.findBy).not.toHaveBeenCalled();
    expect(stateService.findBy).not.toHaveBeenCalled();
    expect(incidentService.findBy).not.toHaveBeenCalled();
    expect(memberService.getIncidentsInEpisode).not.toHaveBeenCalled();
    expect(episodeService.resolveEpisode).not.toHaveBeenCalled();
    expect(episodeService.updateOneById).not.toHaveBeenCalled();

    expectNoPerRowLookups();
  });

  test("one episode's resolve failure does not prevent the other episodes from resolving", async () => {
    const incident1Id: ObjectID = new ObjectID("incident-1");
    const incident2Id: ObjectID = new ObjectID("incident-2");

    episodeService.findBy.mockResolvedValue([
      makeEpisode({ id: EPISODE_1_ID, projectId: PROJECT_1_ID }),
      makeEpisode({ id: EPISODE_2_ID, projectId: PROJECT_1_ID }),
    ]);
    stateService.findBy.mockResolvedValue([makeResolvedState(PROJECT_1_ID)]);
    stubMembers({
      [EPISODE_1_ID.toString()]: [incident1Id],
      [EPISODE_2_ID.toString()]: [incident2Id],
    });
    stubIncidents([
      makeIncident(incident1Id, RESOLVED_ORDER),
      makeIncident(incident2Id, RESOLVED_ORDER),
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
    const resolves: Array<ResolveEpisodeArgs> = resolveCalls();

    expect(resolves).toHaveLength(2);
    expect(
      resolves.map((call: ResolveEpisodeArgs) => {
        return call.episodeId.toString();
      }),
    ).toEqual([EPISODE_1_ID.toString(), EPISODE_2_ID.toString()]);
    expect(mockedLogger.error).toHaveBeenCalled();

    expectNoPerRowLookups();
  });
});
