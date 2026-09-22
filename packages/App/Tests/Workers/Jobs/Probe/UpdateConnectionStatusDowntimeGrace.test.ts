import Probe, {
  ProbeConnectionStatus,
} from "Common/Models/DatabaseModels/Probe";
import ObjectID from "Common/Types/ObjectID";

/*
 * The Probe:UpdateConnectionStatus worker's post-downtime grace (issue
 * #2486), driven through the job with the REAL ProbeConnectionDowntimeGrace.
 *
 * Why it exists: the worker marks a probe Disconnected once its lastAlive is
 * 3 minutes stale, and every such flip fans out to owner notifications
 * ("... not being monitored"). But OneUptime can only hear from a probe while
 * OneUptime itself is running. During a self-hosted upgrade or restart the
 * whole stack is down, so when it comes back EVERY probe's lastAlive is
 * already stale, and the first tick used to run before the probes' next
 * request landed: every probe flipped to Disconnected, then back to
 * Connected a minute later - a message pair per probe for downtime that was
 * the SERVER's, not the probe's. So after a gap in the ticks the worker
 * marks nothing Disconnected for one full cutoff (3 minutes). Connected
 * flips are never held back: a probe that reports in is up.
 *
 * Why the gap is tracked fleet-wide, in Redis: each tick runs on whichever
 * worker replica the queue hands it to, and KEDA adds replicas under load.
 * A per-process grace restarted on every new replica and held back
 * disconnect detection each time the fleet scaled out, although the fleet
 * had been listening all along. Now a replica joining a ticking fleet
 * detects stale probes on its very first tick.
 *
 * GlobalCache is an in-memory fake that honours expiresInSeconds against a
 * fake clock the tests move by hand (a key set at t with 180s is gone at
 * t+180s). An empty cache is what a gap looks like: no tick anywhere for
 * over 120s, so the "ticked-recently" key has expired. ProbeService and
 * QueryHelper are mocked as in UpdateConnectionStatus.test.ts; the findBy
 * stub answers the stale query (lastAlive <= cutoff OR NULL) and the fresh
 * query (lastAlive > cutoff) from two lists, so stale probes are always
 * there to be found and the only thing keeping them from a Disconnected
 * flip is whether the job asks.
 *
 * These tests guard review fix (3), the fleet-wide ProbeConnectionDowntimeGrace
 * that replaced the per-process ProbeConnectionStartupGrace. The grace-expiry,
 * steady-fleet, 5-minute-gap and cache-failure tests fail against the
 * per-process grace: it held back every process's first ticks, and it
 * measured the grace on the real Date, which these tests never move. The
 * first-tick and in-grace tests pin what both versions share.
 */

type CronHandler = () => Promise<void>;

interface CronOptions {
  schedule: string;
  runOnStartup: boolean;
}

interface CapturedJob {
  options: CronOptions;
  handler: CronHandler;
}

/*
 * Captured cron registrations, keyed by job name. Must be declared before the
 * job import below so the mock factory closure can see it.
 */
const mockCapturedJobs: Record<string, CapturedJob> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (
        jobName: string,
        options: CronOptions,
        runFunction: CronHandler,
      ): void => {
        mockCapturedJobs[jobName] = { options, handler: runFunction };
      },
    ),
  };
});

interface MockCacheEntry {
  value: string;
  expiresAtMs: number;
}

interface MockCacheSetOptions {
  expiresInSeconds: number;
}

/*
 * The fake cache's state. Only read inside the fake's functions, which run
 * during the tests, never while the mocked module is being built.
 */
const mockCache: { nowMs: number; entries: Map<string, MockCacheEntry> } = {
  nowMs: 0,
  entries: new Map<string, MockCacheEntry>(),
};

// Mirrors GlobalCache: keys are `${namespace}-${key}`, default TTL 30 days.
function mockFakeGetString(
  namespace: string,
  key: string,
): Promise<string | null> {
  const entry: MockCacheEntry | undefined = mockCache.entries.get(
    `${namespace}-${key}`,
  );

  if (!entry || mockCache.nowMs >= entry.expiresAtMs) {
    return Promise.resolve(null);
  }

  return Promise.resolve(entry.value);
}

function mockFakeSetString(
  namespace: string,
  key: string,
  value: string,
  options?: MockCacheSetOptions,
): Promise<void> {
  const expiresInSeconds: number =
    options?.expiresInSeconds ?? 30 * 24 * 60 * 60;

  mockCache.entries.set(`${namespace}-${key}`, {
    value,
    expiresAtMs: mockCache.nowMs + expiresInSeconds * 1000,
  });

  return Promise.resolve();
}

jest.mock("Common/Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      getString: jest.fn(),
      setString: jest.fn(),
    },
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

jest.mock("Common/Server/Services/ProbeService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      findAllBy: jest.fn(),
      updateOneById: jest.fn(),
      findOneBy: jest.fn(),
      findOneById: jest.fn(),
    },
  };
});

/*
 * Sentinel-returning predicate factories, as in UpdateConnectionStatus.test.ts,
 * so the ProbeService.findBy stub below can tell the "stale" query from the
 * "fresh" query by the predicate on lastAlive.
 */
jest.mock("Common/Server/Types/Database/QueryHelper", () => {
  return {
    __esModule: true,
    default: {
      lessThanEqualToOrNull: jest.fn((value: Date) => {
        return { op: "lessThanEqualToOrNull", value };
      }),
      greaterThan: jest.fn((value: Date) => {
        return { op: "greaterThan", value };
      }),
      notInOrNull: jest.fn((values: Array<string>) => {
        return { op: "notInOrNull", values };
      }),
    },
  };
});

// ProbeConnectionDowntimeGrace is deliberately NOT mocked: it is the subject.

import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import ProbeService from "Common/Server/Services/ProbeService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import logger from "Common/Server/Utils/Logger";

// Imported for its side effect: RunCron (mocked above) records the handler.
import "../../../../FeatureSet/Workers/Jobs/Probe/UpdateConnectionStatus";

interface GlobalCacheMock {
  getString: jest.Mock;
  setString: jest.Mock;
}

interface ProbeServiceMock {
  findBy: jest.Mock;
  findAllBy: jest.Mock;
  updateOneById: jest.Mock;
  findOneBy: jest.Mock;
  findOneById: jest.Mock;
}

interface QueryHelperMock {
  lessThanEqualToOrNull: jest.Mock;
  greaterThan: jest.Mock;
  notInOrNull: jest.Mock;
}

const globalCache: GlobalCacheMock = GlobalCache as unknown as GlobalCacheMock;
const probeService: ProbeServiceMock =
  ProbeService as unknown as ProbeServiceMock;
const queryHelper: QueryHelperMock = QueryHelper as unknown as QueryHelperMock;
const mockedLogger: { error: jest.Mock } = logger as unknown as {
  error: jest.Mock;
};

/*
 * Read right after the import: loading the job must neither touch the cache
 * nor query anything, or the grace would start before the first tick.
 */
const cacheCallsWhenModuleLoaded: number =
  globalCache.getString.mock.calls.length +
  globalCache.setString.mock.calls.length;
const findByCallsWhenModuleLoaded: number =
  probeService.findBy.mock.calls.length;

const JOB_NAME: string = "Probe:UpdateConnectionStatus";

const CACHE_NAMESPACE: string = "probe-connection-status";
const TICKED_RECENTLY_KEY: string = "ticked-recently";

// Where the fake clock starts in every test. Any instant will do.
const START_MS: number = Date.UTC(2026, 8, 22, 12, 0, 0);

const PROJECT_1_ID: ObjectID = new ObjectID("project-1");
const PROJECT_2_ID: ObjectID = new ObjectID("project-2");

// Probes whose lastAlive went stale while OneUptime was down.
const STALE_PROBE_ID: ObjectID = new ObjectID("probe-stale-1");
const OTHER_STALE_PROBE_ID: ObjectID = new ObjectID("probe-stale-2");

// Probes that report in (again) after the gap.
const RECOVERED_PROBE_A_ID: ObjectID = new ObjectID("probe-recovered-a");
const RECOVERED_PROBE_B_ID: ObjectID = new ObjectID("probe-recovered-b");

function makeProbe(id: ObjectID, projectId: ObjectID): Probe {
  const probe: Probe = new Probe(id);
  probe.projectId = projectId;
  return probe;
}

interface PredicateSentinel {
  op: string;
  value?: Date;
  values?: Array<string>;
}

interface FindByArgs {
  query: Record<string, PredicateSentinel>;
  select: Record<string, boolean>;
  skip: number;
  limit: number;
  props: Record<string, unknown>;
}

interface UpdateCallArgs {
  id: ObjectID;
  data: Record<string, unknown>;
  props: Record<string, unknown>;
}

interface WrittenFlip {
  probeId: string;
  connectionStatus: unknown;
}

let staleProbesInDb: Array<Probe> = [];
let freshProbesInDb: Array<Probe> = [];

function issuedQueries(): Array<FindByArgs> {
  return probeService.findBy.mock.calls.map((args: Array<unknown>) => {
    return args[0] as FindByArgs;
  });
}

function lastAlivePredicates(): Array<string> {
  return issuedQueries().map((args: FindByArgs) => {
    return args.query["lastAlive"]!.op;
  });
}

function writtenFlips(): Array<WrittenFlip> {
  return probeService.updateOneById.mock.calls.map((args: Array<unknown>) => {
    const update: UpdateCallArgs = args[0] as UpdateCallArgs;
    return {
      probeId: update.id.toString(),
      connectionStatus: update.data["connectionStatus"],
    };
  });
}

/*
 * Runs one tick at the given fake-clock time. Clears the ProbeService and
 * QueryHelper call records first so each tick's assertions see only that
 * tick; the cache keeps its state across ticks, as Redis would.
 */
async function runTickAt(secondsAfterStart: number): Promise<void> {
  const captured: CapturedJob | undefined = mockCapturedJobs[JOB_NAME];

  if (!captured) {
    throw new Error(
      "Probe:UpdateConnectionStatus did not register a cron handler - the RunCron mock never saw it.",
    );
  }

  probeService.findBy.mockClear();
  probeService.updateOneById.mockClear();
  queryHelper.lessThanEqualToOrNull.mockClear();
  queryHelper.greaterThan.mockClear();
  queryHelper.notInOrNull.mockClear();

  mockCache.nowMs = START_MS + secondsAfterStart * 1000;

  await captured.handler();
}

// A fleet that has been ticking all along: the last tick was just now.
async function seedSteadyFleet(): Promise<void> {
  await mockFakeSetString(CACHE_NAMESPACE, TICKED_RECENTLY_KEY, "1", {
    expiresInSeconds: 120,
  });
}

/*
 * The shape of every tick inside the grace: exactly one SELECT - the connect
 * query - and not a single Disconnected write, whatever the stale query
 * would have found.
 */
function expectTickHeldBackDisconnects(): void {
  expect(probeService.findBy).toHaveBeenCalledTimes(1);
  expect(lastAlivePredicates()).toEqual(["greaterThan"]);
  expect(issuedQueries()[0]!.query["connectionStatus"]).toEqual({
    op: "notInOrNull",
    values: [ProbeConnectionStatus.Connected],
  });
  expect(queryHelper.lessThanEqualToOrNull).not.toHaveBeenCalled();

  for (const flip of writtenFlips()) {
    expect(flip.connectionStatus).not.toBe(ProbeConnectionStatus.Disconnected);
  }
}

// Outside the grace: both SELECTs, stale first, then fresh.
function expectTickLookedForStaleProbes(): void {
  expect(probeService.findBy).toHaveBeenCalledTimes(2);
  expect(lastAlivePredicates()).toEqual([
    "lessThanEqualToOrNull",
    "greaterThan",
  ]);
  expect(issuedQueries()[0]!.query["connectionStatus"]).toEqual({
    op: "notInOrNull",
    values: [ProbeConnectionStatus.Disconnected],
  });
}

describe("Probe:UpdateConnectionStatus post-downtime grace (real ProbeConnectionDowntimeGrace)", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockCache.nowMs = START_MS;
    mockCache.entries.clear();

    // mockReset also drops any leftover mock*Once from a failed test.
    globalCache.getString.mockReset().mockImplementation(mockFakeGetString);
    globalCache.setString.mockReset().mockImplementation(mockFakeSetString);

    staleProbesInDb = [];
    freshProbesInDb = [];

    probeService.findBy.mockImplementation(
      (args: FindByArgs): Promise<Array<Probe>> => {
        const lastAlive: PredicateSentinel | undefined =
          args.query["lastAlive"];

        if (lastAlive?.op === "lessThanEqualToOrNull") {
          return Promise.resolve(staleProbesInDb);
        }

        if (lastAlive?.op === "greaterThan") {
          return Promise.resolve(freshProbesInDb);
        }

        return Promise.reject(
          new Error(`Unexpected lastAlive predicate: ${lastAlive?.op}`),
        );
      },
    );
    probeService.updateOneById.mockResolvedValue(undefined);
  });

  test("loading the job neither touches the cache nor queries probes", () => {
    expect(mockCapturedJobs[JOB_NAME]).toBeDefined();
    expect(cacheCallsWhenModuleLoaded).toBe(0);
    expect(findByCallsWhenModuleLoaded).toBe(0);
  });

  test("the first tick after a gap (empty cache) issues only the connect query: a stale probe is not flipped, a reporting probe is", async () => {
    staleProbesInDb = [makeProbe(STALE_PROBE_ID, PROJECT_1_ID)];
    freshProbesInDb = [makeProbe(RECOVERED_PROBE_A_ID, PROJECT_2_ID)];

    await runTickAt(0);

    expectTickHeldBackDisconnects();

    /*
     * Connecting is never held back: hearing from a probe proves it is up,
     * whatever OneUptime's own uptime.
     */
    expect(writtenFlips()).toEqual([
      {
        probeId: RECOVERED_PROBE_A_ID.toString(),
        connectionStatus: ProbeConnectionStatus.Connected,
      },
    ]);
    expect(probeService.updateOneById.mock.calls[0]![0]).toMatchObject({
      props: { isRoot: true },
    });
  });

  test("ticks during the grace behave the same, and a stale probe is still not flipped", async () => {
    staleProbesInDb = [
      makeProbe(STALE_PROBE_ID, PROJECT_1_ID),
      makeProbe(OTHER_STALE_PROBE_ID, PROJECT_2_ID),
    ];

    await runTickAt(0);
    expectTickHeldBackDisconnects();
    expect(probeService.updateOneById).not.toHaveBeenCalled();

    await runTickAt(60);
    expectTickHeldBackDisconnects();
    expect(probeService.updateOneById).not.toHaveBeenCalled();

    freshProbesInDb = [makeProbe(RECOVERED_PROBE_B_ID, PROJECT_1_ID)];

    await runTickAt(120);
    expectTickHeldBackDisconnects();
    expect(writtenFlips()).toEqual([
      {
        probeId: RECOVERED_PROBE_B_ID.toString(),
        connectionStatus: ProbeConnectionStatus.Connected,
      },
    ]);
  });

  test("once the grace has expired (ticks every minute), both queries run and stale probes are flipped Disconnected", async () => {
    staleProbesInDb = [
      makeProbe(STALE_PROBE_ID, PROJECT_1_ID),
      makeProbe(OTHER_STALE_PROBE_ID, PROJECT_2_ID),
    ];

    await runTickAt(0);
    await runTickAt(60);
    await runTickAt(120);
    expectTickHeldBackDisconnects();

    freshProbesInDb = [makeProbe(RECOVERED_PROBE_A_ID, PROJECT_2_ID)];

    // T+3m: one full cutoff after the first tick after the gap.
    await runTickAt(180);

    expectTickLookedForStaleProbes();
    expect(writtenFlips()).toEqual([
      {
        probeId: STALE_PROBE_ID.toString(),
        connectionStatus: ProbeConnectionStatus.Disconnected,
      },
      {
        probeId: OTHER_STALE_PROBE_ID.toString(),
        connectionStatus: ProbeConnectionStatus.Disconnected,
      },
      {
        probeId: RECOVERED_PROBE_A_ID.toString(),
        connectionStatus: ProbeConnectionStatus.Connected,
      },
    ]);

    // And it stays over.
    staleProbesInDb = [makeProbe(OTHER_STALE_PROBE_ID, PROJECT_2_ID)];
    freshProbesInDb = [];

    await runTickAt(240);

    expectTickLookedForStaleProbes();
    expect(writtenFlips()).toEqual([
      {
        probeId: OTHER_STALE_PROBE_ID.toString(),
        connectionStatus: ProbeConnectionStatus.Disconnected,
      },
    ]);
  });

  test("in a steady fleet (ticked-recently present) the very first tick of this process already runs both queries and flips stale probes", async () => {
    /*
     * This process has never ticked (the job module was loaded once for the
     * whole file and every earlier test's cache was wiped), but other
     * replicas have been ticking: a KEDA scale-out must not delay detection.
     */
    await seedSteadyFleet();

    staleProbesInDb = [makeProbe(STALE_PROBE_ID, PROJECT_1_ID)];
    freshProbesInDb = [makeProbe(RECOVERED_PROBE_A_ID, PROJECT_2_ID)];

    await runTickAt(30);

    expectTickLookedForStaleProbes();
    expect(writtenFlips()).toEqual([
      {
        probeId: STALE_PROBE_ID.toString(),
        connectionStatus: ProbeConnectionStatus.Disconnected,
      },
      {
        probeId: RECOVERED_PROBE_A_ID.toString(),
        connectionStatus: ProbeConnectionStatus.Connected,
      },
    ]);
  });

  test("a steady fleet that stops ticking for 5 minutes (an upgrade) holds back Disconnected flips again when the ticks resume", async () => {
    await seedSteadyFleet();

    staleProbesInDb = [makeProbe(STALE_PROBE_ID, PROJECT_1_ID)];

    await runTickAt(0);
    expectTickLookedForStaleProbes();

    // Down from T+0 to T+5m: every probe is stale when the ticks resume.
    staleProbesInDb = [
      makeProbe(STALE_PROBE_ID, PROJECT_1_ID),
      makeProbe(OTHER_STALE_PROBE_ID, PROJECT_2_ID),
    ];

    await runTickAt(300);

    expectTickHeldBackDisconnects();
    expect(probeService.updateOneById).not.toHaveBeenCalled();
  });

  test("when the cache fails, the grace fails open: both queries run and stale probes are flipped", async () => {
    // Empty cache: without the failure this tick would be inside a grace.
    const error: Error = new Error("Cache is not connected");
    globalCache.getString.mockRejectedValueOnce(error);

    staleProbesInDb = [makeProbe(STALE_PROBE_ID, PROJECT_1_ID)];

    await runTickAt(0);

    expectTickLookedForStaleProbes();
    expect(writtenFlips()).toEqual([
      {
        probeId: STALE_PROBE_ID.toString(),
        connectionStatus: ProbeConnectionStatus.Disconnected,
      },
    ]);
    expect(mockedLogger.error).toHaveBeenCalledWith(error, {
      service: "workers",
    });
  });
});
