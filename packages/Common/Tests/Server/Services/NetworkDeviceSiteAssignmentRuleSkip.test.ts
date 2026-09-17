import NetworkDeviceService, {
  EmptySiteAssignmentRuleCache,
  EMPTY_SITE_ASSIGNMENT_RULE_CACHE_TTL_IN_MS,
} from "../../../Server/Services/NetworkDeviceService";
import NetworkSiteAssignmentRuleService from "../../../Server/Services/NetworkSiteAssignmentRuleService";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkSiteAssignmentRule from "../../../Models/DatabaseModels/NetworkSiteAssignmentRule";
import ObjectID from "../../../Types/ObjectID";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — what a poll costs when a project has no
 * site-assignment rules.
 *
 * Every successful SNMP walk writes `sysName`, an identity column, so
 * onUpdateSuccess re-evaluates the assignment rules for every device that has
 * no site. That rule is correct and stays: rules are usually written after the
 * estate was imported, and the walk is the only thing that ever touches such a
 * device again. What was wasteful is HOW it concluded nothing — a findOneById
 * plus an uncached findBy of the same empty rule set, per device, per poll. On
 * a project mid-rollout that is every device in the fleet.
 *
 * The fix is a negative cache: "this project had zero rules" is remembered for
 * EMPTY_SITE_ASSIGNMENT_RULE_CACHE_TTL_IN_MS. Only the negative answer is
 * cached — a stale rule SET would assign a device by a rule that was edited or
 * deleted seconds ago, which nothing moves back, while a stale "no rules" only
 * defers work the polling interval already defers by minutes.
 *
 * These tests count queries rather than reading the implementation, and they
 * drive the freshness guarantee (TTL expiry, and observation of a first rule)
 * rather than asserting it from the source.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const SITE_A_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RULE_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

/*
 * The TTL this suite drives the clock by, written out rather than imported so
 * that changing the service constant fails HERE. The number is a promise —
 * "a rule saved on another replica takes effect within ten seconds" — and a
 * promise nobody asserts is not a promise. The service's own value is checked
 * against this literal below.
 */
const CACHE_TTL_IN_MS: number = 10 * 1000;

function fakeDevice(overrides: Record<string, unknown>): NetworkDevice {
  return {
    id: DEVICE_ID,
    _id: DEVICE_ID.toString(),
    projectId: PROJECT_ID,
    hostname: "10.0.5.9",
    ...overrides,
  } as unknown as NetworkDevice;
}

function fakeRule(data: {
  siteId: ObjectID;
  subnetCidr?: string;
  hostnamePattern?: string;
  priority?: number;
}): NetworkSiteAssignmentRule {
  return {
    _id: RULE_ID.toString(),
    ...data,
  } as unknown as NetworkSiteAssignmentRule;
}

const MATCHING_RULE: NetworkSiteAssignmentRule = fakeRule({
  siteId: SITE_A_ID,
  subnetCidr: "10.0.0.0/8",
  priority: 1,
});

interface ServiceSpies {
  deviceRead: jest.SpyInstance;
  ruleRead: jest.SpyInstance;
  assign: jest.SpyInstance;
}

/*
 * The three statements the rule path can issue: the device read, the rule read
 * and the assignment write. Counting them is the only honest way to prove a
 * short-circuit actually short-circuits.
 */
function mockServices(
  rules: Array<NetworkSiteAssignmentRule>,
  device: NetworkDevice = fakeDevice({}),
): ServiceSpies {
  return {
    deviceRead: jest
      .spyOn(NetworkDeviceService, "findOneById")
      .mockResolvedValue(device),
    ruleRead: jest
      .spyOn(NetworkSiteAssignmentRuleService, "findBy")
      .mockResolvedValue(rules),
    assign: jest
      .spyOn(NetworkDeviceService, "updateOneById")
      .mockResolvedValue(1 as never),
  };
}

// One SNMP-walk-shaped update: the same sysName the walk rewrites every poll.
function walkUpdate(
  previousDevices: Array<NetworkDevice>,
): OnUpdate<NetworkDevice> {
  return {
    updateBy: {
      query: {},
      data: { sysName: "UN0664LANSWI03" },
      props: { isRoot: true },
    } as unknown as UpdateBy<NetworkDevice>,
    carryForward: {
      previousDevices: previousDevices,
    },
  } as unknown as OnUpdate<NetworkDevice>;
}

let currentTimeInMs: number = 1767225600000;

beforeEach(() => {
  currentTimeInMs = 1767225600000;
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return currentTimeInMs;
  });
  // The service singleton is process-wide; every case starts cold.
  NetworkDeviceService.emptySiteAssignmentRuleCache.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
  NetworkDeviceService.emptySiteAssignmentRuleCache.clear();
});

describe("EmptySiteAssignmentRuleCache", () => {
  function buildCache(options?: {
    ttlInMs?: number | undefined;
    maxProjects?: number | undefined;
  }): EmptySiteAssignmentRuleCache {
    return new EmptySiteAssignmentRuleCache({
      ttlInMs: options?.ttlInMs,
      maxProjects: options?.maxProjects,
      now: (): number => {
        return currentTimeInMs;
      },
    });
  }

  /*
   * The staleness budget itself. Ten seconds is what bounds a rule saved on
   * another replica, which no in-process invalidation can hear about; raising
   * it silently would lengthen that window for every project.
   */
  it("trusts a known-empty answer for ten seconds and no longer", () => {
    expect(EMPTY_SITE_ASSIGNMENT_RULE_CACHE_TTL_IN_MS).toBe(CACHE_TTL_IN_MS);

    const cache: EmptySiteAssignmentRuleCache =
      new EmptySiteAssignmentRuleCache({
        now: (): number => {
          return currentTimeInMs;
        },
      });

    cache.record({ projectId: PROJECT_ID, isEmpty: true });

    currentTimeInMs += CACHE_TTL_IN_MS - 1;
    expect(cache.isKnownEmpty(PROJECT_ID)).toBe(true);

    currentTimeInMs += 1;
    expect(cache.isKnownEmpty(PROJECT_ID)).toBe(false);
  });

  it("knows nothing about a project it has never seen", () => {
    expect(buildCache().isKnownEmpty(PROJECT_ID)).toBe(false);
  });

  it("remembers a project that had no rules", () => {
    const cache: EmptySiteAssignmentRuleCache = buildCache();
    cache.record({ projectId: PROJECT_ID, isEmpty: true });
    expect(cache.isKnownEmpty(PROJECT_ID)).toBe(true);
  });

  /*
   * The boundary is what bounds staleness for a rule saved on ANOTHER replica,
   * which no in-process invalidation can ever hear about.
   */
  it("stops trusting the answer exactly at the TTL", () => {
    const cache: EmptySiteAssignmentRuleCache = buildCache({ ttlInMs: 1000 });
    cache.record({ projectId: PROJECT_ID, isEmpty: true });

    currentTimeInMs += 999;
    expect(cache.isKnownEmpty(PROJECT_ID)).toBe(true);

    currentTimeInMs += 1;
    expect(cache.isKnownEmpty(PROJECT_ID)).toBe(false);
  });

  it("re-recording refreshes the expiry", () => {
    const cache: EmptySiteAssignmentRuleCache = buildCache({ ttlInMs: 1000 });
    cache.record({ projectId: PROJECT_ID, isEmpty: true });

    currentTimeInMs += 900;
    cache.record({ projectId: PROJECT_ID, isEmpty: true });

    currentTimeInMs += 900;
    expect(cache.isKnownEmpty(PROJECT_ID)).toBe(true);
  });

  /*
   * The in-process half of the invalidation story: the moment anything sees
   * that the project does have rules, the skip is gone — no TTL wait.
   */
  it("forgets the project the moment a non-empty rule set is observed", () => {
    const cache: EmptySiteAssignmentRuleCache = buildCache();
    cache.record({ projectId: PROJECT_ID, isEmpty: true });

    cache.record({ projectId: PROJECT_ID, isEmpty: false });

    expect(cache.isKnownEmpty(PROJECT_ID)).toBe(false);
  });

  it("recording a non-empty answer for an unknown project changes nothing", () => {
    const cache: EmptySiteAssignmentRuleCache = buildCache();
    cache.record({ projectId: PROJECT_ID, isEmpty: false });
    expect(cache.isKnownEmpty(PROJECT_ID)).toBe(false);
  });

  // Tenancy: one project's emptiness must never answer for another's.
  it("keeps projects independent", () => {
    const cache: EmptySiteAssignmentRuleCache = buildCache();
    cache.record({ projectId: PROJECT_ID, isEmpty: true });

    expect(cache.isKnownEmpty(PROJECT_ID)).toBe(true);
    expect(cache.isKnownEmpty(OTHER_PROJECT_ID)).toBe(false);
  });

  it("clear() drops every project", () => {
    const cache: EmptySiteAssignmentRuleCache = buildCache();
    cache.record({ projectId: PROJECT_ID, isEmpty: true });
    cache.record({ projectId: OTHER_PROJECT_ID, isEmpty: true });

    cache.clear();

    expect(cache.isKnownEmpty(PROJECT_ID)).toBe(false);
    expect(cache.isKnownEmpty(OTHER_PROJECT_ID)).toBe(false);
  });

  /*
   * An instance serving many projects must not grow this map forever; the
   * oldest entry goes, and losing one only costs a re-read.
   */
  it("evicts the oldest project once it is full", () => {
    const cache: EmptySiteAssignmentRuleCache = buildCache({ maxProjects: 2 });
    const thirdProjectId: ObjectID = new ObjectID(
      "66666666-6666-4666-8666-666666666666",
    );

    cache.record({ projectId: PROJECT_ID, isEmpty: true });
    cache.record({ projectId: OTHER_PROJECT_ID, isEmpty: true });
    cache.record({ projectId: thirdProjectId, isEmpty: true });

    expect(cache.isKnownEmpty(PROJECT_ID)).toBe(false);
    expect(cache.isKnownEmpty(OTHER_PROJECT_ID)).toBe(true);
    expect(cache.isKnownEmpty(thirdProjectId)).toBe(true);
  });

  it("refreshing a project already in a full cache evicts nothing", () => {
    const cache: EmptySiteAssignmentRuleCache = buildCache({ maxProjects: 2 });

    cache.record({ projectId: PROJECT_ID, isEmpty: true });
    cache.record({ projectId: OTHER_PROJECT_ID, isEmpty: true });
    cache.record({ projectId: OTHER_PROJECT_ID, isEmpty: true });

    expect(cache.isKnownEmpty(PROJECT_ID)).toBe(true);
    expect(cache.isKnownEmpty(OTHER_PROJECT_ID)).toBe(true);
  });

  it("is usable again after an entry expires", () => {
    const cache: EmptySiteAssignmentRuleCache = buildCache({ ttlInMs: 1000 });

    cache.record({ projectId: PROJECT_ID, isEmpty: true });
    currentTimeInMs += 5000;
    expect(cache.isKnownEmpty(PROJECT_ID)).toBe(false);

    cache.record({ projectId: PROJECT_ID, isEmpty: true });
    expect(cache.isKnownEmpty(PROJECT_ID)).toBe(true);
  });
});

describe("NetworkDeviceService.applySiteAssignmentRulesToDevice — the no-rules skip", () => {
  /*
   * The headline: on a project with no rules, the second and every later poll
   * of an unattached device issues NO statements at all. Before this, each one
   * cost a device read plus a rule read to reach the same conclusion.
   */
  it("reads once for the project, then skips both queries entirely", async () => {
    const spies: ServiceSpies = mockServices([]);

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(
      DEVICE_ID,
      PROJECT_ID,
    );

    expect(spies.deviceRead).toHaveBeenCalledTimes(1);
    expect(spies.ruleRead).toHaveBeenCalledTimes(1);

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(
      DEVICE_ID,
      PROJECT_ID,
    );
    await NetworkDeviceService.applySiteAssignmentRulesToDevice(
      DEVICE_ID,
      PROJECT_ID,
    );

    expect(spies.deviceRead).toHaveBeenCalledTimes(1);
    expect(spies.ruleRead).toHaveBeenCalledTimes(1);
    expect(spies.assign).not.toHaveBeenCalled();
  });

  /*
   * The bug a cache like this can introduce, driven rather than argued: a rule
   * saved on another replica (which cannot invalidate anything here) has to
   * take effect on its own. The TTL is what promises that.
   */
  it("re-reads after the TTL, so a rule saved elsewhere applies on the next poll", async () => {
    const spies: ServiceSpies = mockServices([]);

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(
      DEVICE_ID,
      PROJECT_ID,
    );
    expect(spies.assign).not.toHaveBeenCalled();

    // Somebody saves a rule on another replica.
    spies.ruleRead.mockResolvedValue([MATCHING_RULE]);

    currentTimeInMs += CACHE_TTL_IN_MS;

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(
      DEVICE_ID,
      PROJECT_ID,
    );

    expect(spies.deviceRead).toHaveBeenCalledTimes(2);
    expect(spies.ruleRead).toHaveBeenCalledTimes(2);
    expect(spies.assign).toHaveBeenCalledTimes(1);
    expect(spies.assign.mock.calls[0]![0].data.siteId.toString()).toBe(
      SITE_A_ID.toString(),
    );
  });

  it("still skips one millisecond before the TTL is up", async () => {
    const spies: ServiceSpies = mockServices([]);

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(
      DEVICE_ID,
      PROJECT_ID,
    );

    currentTimeInMs += CACHE_TTL_IN_MS - 1;

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(
      DEVICE_ID,
      PROJECT_ID,
    );

    expect(spies.deviceRead).toHaveBeenCalledTimes(1);
  });

  /*
   * The behaviour the skip must not damage. A device with no site is the
   * self-healing case: it is how an estate imported before the rules existed
   * ever gets placed.
   */
  it("assigns a device with no site when the project does have rules", async () => {
    const spies: ServiceSpies = mockServices([MATCHING_RULE]);

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(
      DEVICE_ID,
      PROJECT_ID,
    );

    expect(spies.assign).toHaveBeenCalledTimes(1);
    expect(spies.assign.mock.calls[0]![0].data.siteId.toString()).toBe(
      SITE_A_ID.toString(),
    );
  });

  /*
   * Only the NEGATIVE answer is cached. Reusing a rule SET would let a rule
   * that was edited or deleted seconds ago still place a device somewhere
   * nothing will move it back from.
   */
  it("never caches a non-empty rule set — every poll re-reads the rules", async () => {
    const spies: ServiceSpies = mockServices([MATCHING_RULE]);

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(
      DEVICE_ID,
      PROJECT_ID,
    );
    await NetworkDeviceService.applySiteAssignmentRulesToDevice(
      DEVICE_ID,
      PROJECT_ID,
    );

    expect(spies.ruleRead).toHaveBeenCalledTimes(2);
    expect(spies.deviceRead).toHaveBeenCalledTimes(2);
  });

  /*
   * Device creation deliberately passes no project: a rule saved moments ago
   * must apply to the device being imported right now, TTL or no TTL.
   */
  it("never skips when the caller gives no project (the create path)", async () => {
    const spies: ServiceSpies = mockServices([]);

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(
      DEVICE_ID,
      PROJECT_ID,
    );
    expect(spies.deviceRead).toHaveBeenCalledTimes(1);

    spies.ruleRead.mockResolvedValue([MATCHING_RULE]);

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(DEVICE_ID);

    expect(spies.deviceRead).toHaveBeenCalledTimes(2);
    expect(spies.ruleRead).toHaveBeenCalledTimes(2);
    expect(spies.assign).toHaveBeenCalledTimes(1);
  });

  // Tenancy: an empty project must never answer for a busy one.
  it("one project's emptiness never skips another project's device", async () => {
    const spies: ServiceSpies = mockServices([]);

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(
      DEVICE_ID,
      PROJECT_ID,
    );

    spies.ruleRead.mockResolvedValue([MATCHING_RULE]);
    spies.deviceRead.mockResolvedValue(
      fakeDevice({ projectId: OTHER_PROJECT_ID }),
    );

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(
      DEVICE_ID,
      OTHER_PROJECT_ID,
    );

    expect(spies.deviceRead).toHaveBeenCalledTimes(2);
    expect(spies.assign).toHaveBeenCalledTimes(1);
  });

  /*
   * The other direction of self-healing: a project whose last rule was deleted
   * starts being skipped again on the next poll, without a restart.
   */
  it("starts skipping again once the project's last rule is deleted", async () => {
    const spies: ServiceSpies = mockServices([MATCHING_RULE]);

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(
      DEVICE_ID,
      PROJECT_ID,
    );
    expect(spies.ruleRead).toHaveBeenCalledTimes(1);

    spies.ruleRead.mockResolvedValue([]);

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(
      DEVICE_ID,
      PROJECT_ID,
    );
    expect(spies.ruleRead).toHaveBeenCalledTimes(2);

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(
      DEVICE_ID,
      PROJECT_ID,
    );
    expect(spies.ruleRead).toHaveBeenCalledTimes(2);
  });

  /*
   * A device row that vanished between the poll and here must not teach the
   * cache anything — there was no project to answer for.
   */
  it("records nothing when the device cannot be read", async () => {
    const spies: ServiceSpies = mockServices([]);
    spies.deviceRead.mockResolvedValue(null);

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(
      DEVICE_ID,
      PROJECT_ID,
    );

    expect(spies.ruleRead).not.toHaveBeenCalled();
    expect(
      NetworkDeviceService.emptySiteAssignmentRuleCache.isKnownEmpty(
        PROJECT_ID,
      ),
    ).toBe(false);
  });
});

describe("NetworkDeviceService.applySiteAssignmentRuleToExistingDevices — the manual run", () => {
  /*
   * "Run now" is pressed right after saving a rule. It must never consult the
   * negative cache, and running it lifts the skip immediately — this is the
   * in-process invalidation that saves the operator the TTL wait.
   */
  it("runs on fresh rules even while the project is cached as empty, and lifts the skip", async () => {
    const spies: ServiceSpies = mockServices([]);

    await NetworkDeviceService.applySiteAssignmentRulesToDevice(
      DEVICE_ID,
      PROJECT_ID,
    );
    expect(
      NetworkDeviceService.emptySiteAssignmentRuleCache.isKnownEmpty(
        PROJECT_ID,
      ),
    ).toBe(true);

    // The rule the operator just saved.
    spies.ruleRead.mockResolvedValue([MATCHING_RULE]);
    // No devices to page over: the run only has to read the rules.
    jest.spyOn(NetworkDeviceService, "findBy").mockResolvedValue([]);

    await NetworkDeviceService.applySiteAssignmentRuleToExistingDevices({
      ruleId: RULE_ID,
      projectId: PROJECT_ID,
      reassignDevicesAlreadyInASite: false,
    });

    expect(spies.ruleRead).toHaveBeenCalledTimes(2);
    expect(
      NetworkDeviceService.emptySiteAssignmentRuleCache.isKnownEmpty(
        PROJECT_ID,
      ),
    ).toBe(false);

    // And the very next poll re-reads instead of skipping.
    await NetworkDeviceService.applySiteAssignmentRulesToDevice(
      DEVICE_ID,
      PROJECT_ID,
    );
    expect(spies.ruleRead).toHaveBeenCalledTimes(3);
  });
});

describe("NetworkDeviceService.onUpdateSuccess — what an SNMP walk costs", () => {
  async function runWalkUpdate(
    previousDevices: Array<NetworkDevice>,
  ): Promise<void> {
    await (NetworkDeviceService as any).onUpdateSuccess(
      walkUpdate(previousDevices),
      [DEVICE_ID],
    );
  }

  /*
   * The end-to-end number this change exists for. A project mid-rollout has
   * every device unattached; each poll used to cost two extra statements per
   * device and now costs none once the project's answer is known.
   */
  it("costs two queries for the first unattached device and none for later polls", async () => {
    const spies: ServiceSpies = mockServices([], fakeDevice({}));

    await runWalkUpdate([fakeDevice({})]);

    expect(spies.deviceRead).toHaveBeenCalledTimes(1);
    expect(spies.ruleRead).toHaveBeenCalledTimes(1);

    await runWalkUpdate([fakeDevice({})]);
    await runWalkUpdate([fakeDevice({})]);

    expect(spies.deviceRead).toHaveBeenCalledTimes(1);
    expect(spies.ruleRead).toHaveBeenCalledTimes(1);
  });

  /*
   * The skip lives behind shouldReapplySiteAssignmentRules, which must keep
   * deciding first: a device someone placed by hand is not dragged back to
   * whatever a rule prefers just because the walk rewrote the same sysName.
   */
  it("a placed device whose sysName did not change never reaches the rule path", async () => {
    const spies: ServiceSpies = mockServices([MATCHING_RULE]);

    await runWalkUpdate([
      fakeDevice({ siteId: SITE_A_ID, sysName: "UN0664LANSWI03" }),
    ]);

    expect(spies.deviceRead).not.toHaveBeenCalled();
    expect(spies.ruleRead).not.toHaveBeenCalled();
    expect(spies.assign).not.toHaveBeenCalled();
  });

  it("a placed device whose sysName really changed still re-evaluates", async () => {
    const spies: ServiceSpies = mockServices([MATCHING_RULE]);

    await runWalkUpdate([fakeDevice({ siteId: SITE_A_ID, sysName: "sw-01" })]);

    expect(spies.deviceRead).toHaveBeenCalledTimes(1);
    expect(spies.ruleRead).toHaveBeenCalledTimes(1);
  });

  /*
   * The skip is only ever a DEFERRAL, and this is what makes that true.
   *
   * An unattached device is re-evaluated on every single poll, so skipping it
   * costs one cycle and the next poll picks it up. A device that already has a
   * site is re-evaluated only when its identity actually CHANGED — a one-shot
   * event. Skipping that is not a deferral, it is a loss: the rename never
   * happens again, so on every later poll `shouldReapplySiteAssignmentRules`
   * returns false, the device keeps its old site indefinitely, and nothing
   * anywhere says so.
   *
   * The window is narrow — the project must gain its FIRST rule inside the
   * ten seconds after a poll found none — but it is silent and permanent when
   * it opens, which is exactly the trade the cache must not make. So the
   * identity path never consults it.
   */
  it("a renamed placed device is never skipped by the empty-rules cache", async () => {
    // A poll of an unattached device arms the skip for this project.
    const armSpies: ServiceSpies = mockServices([], fakeDevice({}));
    await runWalkUpdate([fakeDevice({})]);
    expect(armSpies.ruleRead).toHaveBeenCalledTimes(1);
    expect(
      NetworkDeviceService.emptySiteAssignmentRuleCache.isKnownEmpty(
        PROJECT_ID,
      ),
    ).toBe(true);

    jest.restoreAllMocks();
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return currentTimeInMs;
    });

    // The operator saves the project's first rule a second later...
    currentTimeInMs += 1000;
    const spies: ServiceSpies = mockServices([MATCHING_RULE]);

    // ...and a device that ALREADY HAS A SITE is renamed on the box.
    await runWalkUpdate([fakeDevice({ siteId: SITE_A_ID, sysName: "sw-01" })]);

    // The rules were read despite the armed skip, and the rename was applied.
    expect(spies.ruleRead).toHaveBeenCalledTimes(1);
    expect(spies.assign).toHaveBeenCalledTimes(1);
  });

  /*
   * ...and the deferral it IS allowed to make still happens, or the change
   * would have bought nothing. Same armed cache, same window — an UNATTACHED
   * device is skipped, because its next poll retries unconditionally.
   */
  it("an unattached device is still skipped in that same window", async () => {
    const armSpies: ServiceSpies = mockServices([], fakeDevice({}));
    await runWalkUpdate([fakeDevice({})]);
    expect(armSpies.ruleRead).toHaveBeenCalledTimes(1);

    jest.restoreAllMocks();
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return currentTimeInMs;
    });

    currentTimeInMs += 1000;
    const spies: ServiceSpies = mockServices([MATCHING_RULE]);

    await runWalkUpdate([fakeDevice({ sysName: "UN0664LANSWI03" })]);

    expect(spies.deviceRead).not.toHaveBeenCalled();
    expect(spies.ruleRead).not.toHaveBeenCalled();
  });

  it("an unattached device is still assigned when the project has rules", async () => {
    const spies: ServiceSpies = mockServices([MATCHING_RULE]);

    await runWalkUpdate([fakeDevice({ sysName: "UN0664LANSWI03" })]);

    expect(spies.assign).toHaveBeenCalledTimes(1);
    expect(spies.assign.mock.calls[0]![0].data.siteId.toString()).toBe(
      SITE_A_ID.toString(),
    );
  });

  /*
   * The project has to come from the PREVIOUS snapshot, which the hook already
   * loaded — reading it from the device row would need the very query the skip
   * is trying to avoid.
   */
  it("hands the previous snapshot's project down so the skip can run before any read", async () => {
    const applySpy: jest.SpyInstance = jest
      .spyOn(NetworkDeviceService, "applySiteAssignmentRulesToDevice")
      .mockResolvedValue(undefined as never);

    await runWalkUpdate([fakeDevice({})]);

    expect(applySpy).toHaveBeenCalledTimes(1);
    expect(applySpy.mock.calls[0]![0].toString()).toBe(DEVICE_ID.toString());
    expect(applySpy.mock.calls[0]![1].toString()).toBe(PROJECT_ID.toString());
  });

  /*
   * With no snapshot there is no project to key the skip on, so the device is
   * re-evaluated unconditionally — the safe direction.
   */
  it("re-evaluates unconditionally when no previous snapshot exists", async () => {
    const spies: ServiceSpies = mockServices([]);

    await runWalkUpdate([]);
    await runWalkUpdate([]);

    expect(spies.deviceRead).toHaveBeenCalledTimes(2);
  });
});
