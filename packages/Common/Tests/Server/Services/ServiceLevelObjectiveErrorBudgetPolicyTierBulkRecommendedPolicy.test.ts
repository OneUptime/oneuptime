import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveErrorBudgetPolicyTier from "../../../Models/DatabaseModels/ServiceLevelObjectiveErrorBudgetPolicyTier";
import ServiceLevelObjectiveErrorBudgetPolicyTierService, {
  SLO_NOT_FOUND_MESSAGE,
  SloAddedRecommendedPolicyTiers,
  SloBulkAddedRecommendedPolicy,
  SloBulkMissingRecommendedPolicy,
} from "../../../Server/Services/ServiceLevelObjectiveErrorBudgetPolicyTierService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteOneBy from "../../../Server/Types/Database/DeleteOneBy";
import FindAllBy from "../../../Server/Types/Database/FindAllBy";
import FindBy from "../../../Server/Types/Database/FindBy";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import {
  SLO_BULK_NO_IDS_MESSAGE,
  SLO_BULK_TOO_MANY_MESSAGE,
  SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS,
} from "../../../Utils/Slo/SloBulkRecommendedBurnRateRules";
import {
  SLO_BULK_POLICY_ADD_FAILED_MESSAGE,
  SloBulkRecommendedPolicyStatus,
} from "../../../Utils/Slo/SloBulkRecommendedPolicy";
import {
  SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME,
  SLO_POLICY_CAUTION_TIER_NAME,
  SLO_POLICY_RELIABILITY_FIRST_TIER_NAME,
  SLO_RECOMMENDED_POLICY_TIERS,
  SloRecommendedPolicyState,
  SloRecommendedPolicyTier,
} from "../../../Utils/Slo/SloErrorBudgetPolicy";
import InMemoryLocks from "../TestingUtils/InMemoryLocks";
import { getJestSpyOn } from "../../Spy";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * "Use the recommended policy" for many SLOs at once (the SLO list's Bulk
 * Actions, #6358), on the server.
 *
 * What is pinned:
 *
 *   - asking what many SLOs would get reads the SLOs AS THE CALLER, in one
 *     read pinned to their project - an SLO they may not read, or of
 *     another project, is Refused as not found and nothing of it is read -
 *     then every tier of the SLOs found, as root, once; and it answers each
 *     SLO by the Error Budget Policy page's rule: no policy gets the whole
 *     recommended one, part of it gets the rest, every recommended tier is
 *     NothingMissing, a policy of the team's own is OwnPolicy. It writes
 *     nothing;
 *   - adding to many SLOs takes each through the one-SLO add, one after
 *     another: its own lock, its standing worked out again inside it, each
 *     tier created as the caller, all of an SLO's tiers or none;
 *   - one SLO's refusal or failure is its own, and the SLOs after it are
 *     added to; an SLO with a policy of its own is never added to;
 *   - it is idempotent: a second run adds nothing;
 *   - a request names between one and the cap of SLOs, each once, and is
 *     answered in the order it named them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "63580000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("63580000-0000-4000-8000-000000000002");

const SLO_EMPTY: ObjectID = new ObjectID(
  "a6358000-0000-4000-8000-00000000000a",
);
const SLO_HALF: ObjectID = new ObjectID("b6358000-0000-4000-8000-00000000000b");
const SLO_COMPLETE: ObjectID = new ObjectID(
  "c6358000-0000-4000-8000-00000000000c",
);
const SLO_OWN: ObjectID = new ObjectID("d6358000-0000-4000-8000-00000000000d");
const SLO_UNREADABLE: ObjectID = new ObjectID(
  "e6358000-0000-4000-8000-00000000000e",
);

const LOCK_NAMESPACE: string =
  "ServiceLevelObjectiveErrorBudgetPolicyTierService.addMissingRecommendedTiers";

const TierService: typeof ServiceLevelObjectiveErrorBudgetPolicyTierService =
  ServiceLevelObjectiveErrorBudgetPolicyTierService;

function caller(): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
  };
}

function sloOf(id: ObjectID): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo._id = id.toString();
  slo.id = id;
  slo.projectId = PROJECT_ID;
  return slo;
}

function tierOf(
  sloId: ObjectID,
  name: string,
  thresholdPercentage: number,
): ServiceLevelObjectiveErrorBudgetPolicyTier {
  const tier: ServiceLevelObjectiveErrorBudgetPolicyTier =
    new ServiceLevelObjectiveErrorBudgetPolicyTier();
  tier._id = ObjectID.generate().toString();
  tier.id = new ObjectID(tier._id);
  tier.serviceLevelObjectiveId = sloId;
  tier.projectId = PROJECT_ID;
  tier.name = name;
  tier.thresholdPercentage = thresholdPercentage;
  return tier;
}

function keyOf(id: unknown): string {
  return String(id).toLowerCase();
}

// The ids a QueryHelper.any(...) operator holds.
function idsIn(operator: unknown): Array<string> {
  const parameters: Record<string, unknown> =
    (operator as { objectLiteralParameters?: Record<string, unknown> })
      .objectLiteralParameters || {};

  return ((Object.values(parameters)[0] as Array<unknown>) || []).map(keyOf);
}

function namesOf(tiers: ReadonlyArray<{ name: string }>): Array<string> {
  return tiers.map((tier: { name: string }): string => {
    return tier.name;
  });
}

/*
 * The project as Postgres would hold it: the SLOs the caller may read (one
 * left out of `readable` is one they may not), and every tier.
 */
let readable: Map<string, ServiceLevelObjective>;
let storedTiers: Array<ServiceLevelObjectiveErrorBudgetPolicyTier>;
let createFailure:
  | ((tier: ServiceLevelObjectiveErrorBudgetPolicyTier) => Error | null)
  | null;
let locks: InMemoryLocks;

let bulkSloReadSpy: jest.SpyInstance;
let bulkTierReadSpy: jest.SpyInstance;
let createSpy: jest.SpyInstance;
let loggerErrorSpy: jest.SpyInstance;

function store(...slos: Array<ServiceLevelObjective>): void {
  for (const slo of slos) {
    readable.set(keyOf(slo.id), slo);
  }
}

function tiersOf(sloId: ObjectID): Array<string> {
  return namesOf(
    storedTiers
      .filter((tier: ServiceLevelObjectiveErrorBudgetPolicyTier): boolean => {
        return keyOf(tier.serviceLevelObjectiveId) === keyOf(sloId);
      })
      .map(
        (
          tier: ServiceLevelObjectiveErrorBudgetPolicyTier,
        ): {
          name: string;
        } => {
          return { name: tier.name || "" };
        },
      ),
  );
}

/*
 * The project the tests start from: an SLO with no policy, one with the half
 * policy #6978 left, one with the whole recommended policy, one with a
 * policy of its own (its 50% tier is the team's "Yellow" - by threshold
 * Caution's, but its 10% "Red" is none of the recommended tiers), and one
 * the caller may not read.
 */
function seedProject(): void {
  store(sloOf(SLO_EMPTY), sloOf(SLO_HALF), sloOf(SLO_COMPLETE), sloOf(SLO_OWN));

  storedTiers.push(
    tierOf(SLO_HALF, SLO_POLICY_CAUTION_TIER_NAME, 50),
    tierOf(SLO_HALF, SLO_POLICY_RELIABILITY_FIRST_TIER_NAME, 25),
    ...SLO_RECOMMENDED_POLICY_TIERS.map(
      (
        tier: SloRecommendedPolicyTier,
      ): ServiceLevelObjectiveErrorBudgetPolicyTier => {
        return tierOf(SLO_COMPLETE, tier.name, tier.thresholdPercentage);
      },
    ),
    tierOf(SLO_OWN, "Yellow", 50),
    tierOf(SLO_OWN, "Red", 10),
  );
}

beforeEach(() => {
  readable = new Map();
  storedTiers = [];
  createFailure = null;

  loggerErrorSpy = getJestSpyOn(logger, "error").mockImplementation(
    (): void => {
      return undefined;
    },
  );

  // The bulk question's one read of the SLOs, as the caller.
  bulkSloReadSpy = getJestSpyOn(
    ServiceLevelObjectiveService,
    "findBy",
  ).mockImplementation((async (
    findBy: FindBy<ServiceLevelObjective>,
  ): Promise<Array<ServiceLevelObjective>> => {
    const asked: Array<string> = idsIn(
      (findBy.query as Record<string, unknown>)["_id"],
    );

    return asked
      .map((id: string): ServiceLevelObjective | undefined => {
        return readable.get(id);
      })
      .filter((slo: ServiceLevelObjective | undefined): boolean => {
        return Boolean(slo);
      }) as Array<ServiceLevelObjective>;
  }) as never);

  // The one-SLO add's read of its SLO, as the caller.
  getJestSpyOn(ServiceLevelObjectiveService, "findOneBy").mockImplementation(
    (async (
      findOneBy: FindOneBy<ServiceLevelObjective>,
    ): Promise<ServiceLevelObjective | null> => {
      return (
        readable.get(
          keyOf((findOneBy.query as Record<string, unknown>)["_id"]),
        ) || null
      );
    }) as never,
  );

  // The bulk question's read of every tier of the SLOs it found, as root.
  bulkTierReadSpy = getJestSpyOn(TierService, "findAllBy").mockImplementation(
    (async (
      findAllBy: FindAllBy<ServiceLevelObjectiveErrorBudgetPolicyTier>,
    ): Promise<Array<ServiceLevelObjectiveErrorBudgetPolicyTier>> => {
      const asked: Array<string> = idsIn(
        (findAllBy.query as Record<string, unknown>)["serviceLevelObjectiveId"],
      );

      return storedTiers.filter(
        (tier: ServiceLevelObjectiveErrorBudgetPolicyTier): boolean => {
          return asked.includes(keyOf(tier.serviceLevelObjectiveId));
        },
      );
    }) as never,
  );

  // The one-SLO add's read of its SLO's tiers, as root.
  getJestSpyOn(TierService, "findBy").mockImplementation((async (
    findBy: FindBy<ServiceLevelObjectiveErrorBudgetPolicyTier>,
  ): Promise<Array<ServiceLevelObjectiveErrorBudgetPolicyTier>> => {
    const sloId: string = keyOf(
      (findBy.query as Record<string, unknown>)["serviceLevelObjectiveId"],
    );

    return storedTiers.filter(
      (tier: ServiceLevelObjectiveErrorBudgetPolicyTier): boolean => {
        return keyOf(tier.serviceLevelObjectiveId) === sloId;
      },
    );
  }) as never);

  // A created tier is stored, as Postgres would, so the next read sees it.
  createSpy = getJestSpyOn(TierService, "create").mockImplementation((async (
    createBy: CreateBy<ServiceLevelObjectiveErrorBudgetPolicyTier>,
  ): Promise<ServiceLevelObjectiveErrorBudgetPolicyTier> => {
    const failure: Error | null = createFailure
      ? createFailure(createBy.data)
      : null;

    if (failure) {
      throw failure;
    }

    const created: ServiceLevelObjectiveErrorBudgetPolicyTier = createBy.data;
    created._id = ObjectID.generate().toString();
    created.id = new ObjectID(created._id);
    storedTiers.push(created);

    return created;
  }) as never);

  // The all-or-nothing undo of an add that failed part of the way.
  getJestSpyOn(TierService, "deleteOneBy").mockImplementation((async (
    deleteOneBy: DeleteOneBy<ServiceLevelObjectiveErrorBudgetPolicyTier>,
  ): Promise<void> => {
    const id: string = keyOf(
      (deleteOneBy.query as Record<string, unknown>)["_id"],
    );

    storedTiers = storedTiers.filter(
      (tier: ServiceLevelObjectiveErrorBudgetPolicyTier): boolean => {
        return keyOf(tier._id) !== id;
      },
    );
  }) as never);

  locks = new InMemoryLocks();
  locks.install();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what many SLOs would get", () => {
  it("answers each SLO by the Error Budget Policy page's rule, in the order asked", async () => {
    seedProject();

    const results: Array<SloBulkMissingRecommendedPolicy> =
      await TierService.getMissingRecommendedTiersForMany({
        serviceLevelObjectiveIds: [
          SLO_OWN,
          SLO_EMPTY,
          SLO_UNREADABLE,
          SLO_HALF,
          SLO_COMPLETE,
        ],
        props: caller(),
      });

    expect(
      results.map((result: SloBulkMissingRecommendedPolicy): Array<unknown> => {
        return [
          keyOf(result.serviceLevelObjectiveId),
          result.status,
          namesOf(result.tiers),
          result.message,
        ];
      }),
    ).toEqual([
      [keyOf(SLO_OWN), SloBulkRecommendedPolicyStatus.OwnPolicy, [], null],
      [
        keyOf(SLO_EMPTY),
        SloBulkRecommendedPolicyStatus.Missing,
        [
          SLO_POLICY_CAUTION_TIER_NAME,
          SLO_POLICY_RELIABILITY_FIRST_TIER_NAME,
          SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME,
        ],
        null,
      ],
      [
        keyOf(SLO_UNREADABLE),
        SloBulkRecommendedPolicyStatus.Refused,
        [],
        SLO_NOT_FOUND_MESSAGE,
      ],
      // The half policy #6978 left gets Budget exhausted, which freezes deployments.
      [
        keyOf(SLO_HALF),
        SloBulkRecommendedPolicyStatus.Missing,
        [SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME],
        null,
      ],
      [
        keyOf(SLO_COMPLETE),
        SloBulkRecommendedPolicyStatus.NothingMissing,
        [],
        null,
      ],
    ]);
  });

  it("reads the SLOs as the caller and the tiers as root, each once, and writes nothing", async () => {
    seedProject();

    await TierService.getMissingRecommendedTiersForMany({
      serviceLevelObjectiveIds: [SLO_EMPTY, SLO_HALF, SLO_UNREADABLE],
      props: caller(),
    });

    expect(bulkSloReadSpy).toHaveBeenCalledTimes(1);
    const sloRead: FindBy<ServiceLevelObjective> = bulkSloReadSpy.mock
      .calls[0]![0] as FindBy<ServiceLevelObjective>;
    expect(sloRead.props).toEqual(caller());
    expect(keyOf((sloRead.query as Record<string, unknown>)["projectId"])).toBe(
      keyOf(PROJECT_ID),
    );

    expect(bulkTierReadSpy).toHaveBeenCalledTimes(1);
    const tierRead: FindAllBy<ServiceLevelObjectiveErrorBudgetPolicyTier> =
      bulkTierReadSpy.mock
        .calls[0]![0] as FindAllBy<ServiceLevelObjectiveErrorBudgetPolicyTier>;
    expect(tierRead.props).toEqual({ isRoot: true });
    // Only the SLOs the caller may read: nothing of the other is read.
    expect(
      idsIn(
        (tierRead.query as Record<string, unknown>)["serviceLevelObjectiveId"],
      ),
    ).toEqual([keyOf(SLO_EMPTY), keyOf(SLO_HALF)]);

    expect(createSpy).not.toHaveBeenCalled();
  });

  it("reads no tier at all when the caller may read none of the SLOs", async () => {
    const results: Array<SloBulkMissingRecommendedPolicy> =
      await TierService.getMissingRecommendedTiersForMany({
        serviceLevelObjectiveIds: [SLO_UNREADABLE],
        props: caller(),
      });

    expect(bulkTierReadSpy).not.toHaveBeenCalled();
    expect(results[0]!.status).toBe(SloBulkRecommendedPolicyStatus.Refused);
  });

  it("counts a reworded recommended tier, or one moved off its threshold, as the recommended one", async () => {
    store(sloOf(SLO_HALF));
    storedTiers.push(
      // Caution, moved to 60%: the team's own Caution.
      tierOf(SLO_HALF, SLO_POLICY_CAUTION_TIER_NAME, 60),
      // Reliability first, reworded: still the 25% tier.
      tierOf(SLO_HALF, "Reliability before features", 25),
    );

    const results: Array<SloBulkMissingRecommendedPolicy> =
      await TierService.getMissingRecommendedTiersForMany({
        serviceLevelObjectiveIds: [SLO_HALF],
        props: caller(),
      });

    expect(results[0]!.status).toBe(SloBulkRecommendedPolicyStatus.Missing);
    expect(namesOf(results[0]!.tiers)).toEqual([
      SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME,
    ]);
  });

  it("names each SLO once, and refuses a request of no SLOs or of more than the cap", async () => {
    seedProject();

    const results: Array<SloBulkMissingRecommendedPolicy> =
      await TierService.getMissingRecommendedTiersForMany({
        serviceLevelObjectiveIds: [
          SLO_EMPTY,
          new ObjectID(SLO_EMPTY.toString().toUpperCase()),
        ],
        props: caller(),
      });

    expect(results).toHaveLength(1);

    await expect(
      TierService.getMissingRecommendedTiersForMany({
        serviceLevelObjectiveIds: [],
        props: caller(),
      }),
    ).rejects.toThrow(new BadDataException(SLO_BULK_NO_IDS_MESSAGE));

    await expect(
      TierService.getMissingRecommendedTiersForMany({
        serviceLevelObjectiveIds: Array.from(
          { length: SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS + 1 },
          (): ObjectID => {
            return ObjectID.generate();
          },
        ),
        props: caller(),
      }),
    ).rejects.toThrow(new BadDataException(SLO_BULK_TOO_MANY_MESSAGE));
  });

  it("refuses a caller with no project", async () => {
    await expect(
      TierService.getMissingRecommendedTiersForMany({
        serviceLevelObjectiveIds: [SLO_EMPTY],
        props: { userId: USER_ID, userType: UserType.User },
      }),
    ).rejects.toThrow(BadDataException);
  });
});

describe("adding the recommended policy to many SLOs", () => {
  it("gives the SLOs it is offered to the tiers they miss, leaves the rest as they are, and says so", async () => {
    seedProject();

    const results: Array<SloBulkAddedRecommendedPolicy> =
      await TierService.addMissingRecommendedTiersToMany({
        serviceLevelObjectiveIds: [
          SLO_EMPTY,
          SLO_HALF,
          SLO_COMPLETE,
          SLO_OWN,
          SLO_UNREADABLE,
        ],
        props: caller(),
      });

    expect(
      results.map((result: SloBulkAddedRecommendedPolicy): Array<unknown> => {
        return [
          keyOf(result.serviceLevelObjectiveId),
          result.status,
          namesOf(result.tiers),
        ];
      }),
    ).toEqual([
      [
        keyOf(SLO_EMPTY),
        SloBulkRecommendedPolicyStatus.Added,
        [
          SLO_POLICY_CAUTION_TIER_NAME,
          SLO_POLICY_RELIABILITY_FIRST_TIER_NAME,
          SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME,
        ],
      ],
      [
        keyOf(SLO_HALF),
        SloBulkRecommendedPolicyStatus.Added,
        [SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME],
      ],
      [keyOf(SLO_COMPLETE), SloBulkRecommendedPolicyStatus.NothingMissing, []],
      [keyOf(SLO_OWN), SloBulkRecommendedPolicyStatus.OwnPolicy, []],
      [keyOf(SLO_UNREADABLE), SloBulkRecommendedPolicyStatus.Refused, []],
    ]);

    // A policy of the team's own is never added to.
    expect(tiersOf(SLO_OWN)).toEqual(["Yellow", "Red"]);
    // The half policy is whole again, with the tier that freezes deployments.
    expect(tiersOf(SLO_HALF)).toEqual([
      SLO_POLICY_CAUTION_TIER_NAME,
      SLO_POLICY_RELIABILITY_FIRST_TIER_NAME,
      SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME,
    ]);
    expect(
      storedTiers.find(
        (tier: ServiceLevelObjectiveErrorBudgetPolicyTier): boolean => {
          return (
            keyOf(tier.serviceLevelObjectiveId) === keyOf(SLO_HALF) &&
            tier.name === SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME
          );
        },
      )?.freezesDeployments,
    ).toBe(true);
  });

  it("creates each tier as the caller, under each SLO's own lock", async () => {
    store(sloOf(SLO_EMPTY), sloOf(SLO_HALF));

    await TierService.addMissingRecommendedTiersToMany({
      serviceLevelObjectiveIds: [SLO_EMPTY, SLO_HALF],
      props: caller(),
    });

    expect(createSpy).toHaveBeenCalledTimes(6);

    for (const call of createSpy.mock.calls) {
      expect(
        (call[0] as CreateBy<ServiceLevelObjectiveErrorBudgetPolicyTier>).props,
      ).toEqual(caller());
    }

    expect(locks.events).toEqual(
      expect.arrayContaining([
        `lock:${LOCK_NAMESPACE}/${SLO_EMPTY.toString()}`,
        `lock:${LOCK_NAMESPACE}/${SLO_HALF.toString()}`,
      ]),
    );
  });

  it("adds nothing the second time", async () => {
    seedProject();

    await TierService.addMissingRecommendedTiersToMany({
      serviceLevelObjectiveIds: [SLO_EMPTY, SLO_HALF],
      props: caller(),
    });

    createSpy.mockClear();

    const again: Array<SloBulkAddedRecommendedPolicy> =
      await TierService.addMissingRecommendedTiersToMany({
        serviceLevelObjectiveIds: [SLO_EMPTY, SLO_HALF],
        props: caller(),
      });

    expect(createSpy).not.toHaveBeenCalled();
    expect(
      again.map((result: SloBulkAddedRecommendedPolicy): string => {
        return result.status;
      }),
    ).toEqual([
      SloBulkRecommendedPolicyStatus.NothingMissing,
      SloBulkRecommendedPolicyStatus.NothingMissing,
    ]);
  });

  it("reports an SLO whose tier could not be created as Failed with nothing added, logs it, and goes on to the next", async () => {
    store(sloOf(SLO_EMPTY), sloOf(SLO_HALF));
    createFailure = (
      tier: ServiceLevelObjectiveErrorBudgetPolicyTier,
    ): Error | null => {
      return keyOf(tier.serviceLevelObjectiveId) === keyOf(SLO_EMPTY) &&
        tier.name === SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME
        ? new Error("connection reset")
        : null;
    };

    const results: Array<SloBulkAddedRecommendedPolicy> =
      await TierService.addMissingRecommendedTiersToMany({
        serviceLevelObjectiveIds: [SLO_EMPTY, SLO_HALF],
        props: caller(),
      });

    expect(results[0]).toEqual({
      serviceLevelObjectiveId: SLO_EMPTY,
      status: SloBulkRecommendedPolicyStatus.Failed,
      tiers: [],
      message: SLO_BULK_POLICY_ADD_FAILED_MESSAGE,
    });
    // All or nothing: the two tiers it added before the failure are gone again.
    expect(tiersOf(SLO_EMPTY)).toEqual([]);
    expect(loggerErrorSpy).toHaveBeenCalled();

    // The SLO after it got its policy.
    expect(results[1]!.status).toBe(SloBulkRecommendedPolicyStatus.Added);
    expect(tiersOf(SLO_HALF)).toHaveLength(3);
  });

  it("reports a refusal of the caller as Refused, in its own words, unlogged", async () => {
    store(sloOf(SLO_EMPTY));
    createFailure = (): Error => {
      return new NotAuthorizedException(
        "You do not have permission to create an SLO error budget policy tier.",
      );
    };

    const results: Array<SloBulkAddedRecommendedPolicy> =
      await TierService.addMissingRecommendedTiersToMany({
        serviceLevelObjectiveIds: [SLO_EMPTY],
        props: caller(),
      });

    expect(results[0]!.status).toBe(SloBulkRecommendedPolicyStatus.Refused);
    expect(results[0]!.message).toBe(
      "You do not have permission to create an SLO error budget policy tier.",
    );
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });

  it("refuses a request of more SLOs than the cap before adding to any", async () => {
    await expect(
      TierService.addMissingRecommendedTiersToMany({
        serviceLevelObjectiveIds: Array.from(
          { length: SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS + 1 },
          (): ObjectID => {
            return ObjectID.generate();
          },
        ),
        props: caller(),
      }),
    ).rejects.toThrow(new BadDataException(SLO_BULK_TOO_MANY_MESSAGE));

    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe("the one-SLO add, told to add only where the page offers the policy", () => {
  it("leaves a policy of the team's own as it is, decided inside the lock", async () => {
    seedProject();

    const added: SloAddedRecommendedPolicyTiers =
      await TierService.addMissingRecommendedTiers({
        serviceLevelObjectiveId: SLO_OWN,
        props: caller(),
        onlyWhenOffered: true,
      });

    expect(added.tiers).toEqual([]);
    expect(added.state).toBe(SloRecommendedPolicyState.OwnPolicy);
    expect(createSpy).not.toHaveBeenCalled();
    expect(locks.events).toContain(
      `lock:${LOCK_NAMESPACE}/${SLO_OWN.toString()}`,
    );
  });

  it("without being told, still adds what is missing by name and threshold, as the API always has", async () => {
    seedProject();

    const added: SloAddedRecommendedPolicyTiers =
      await TierService.addMissingRecommendedTiers({
        serviceLevelObjectiveId: SLO_OWN,
        props: caller(),
      });

    // Yellow holds Caution's 50%; Reliability first and Budget exhausted are added.
    expect(namesOf(added.tiers)).toEqual([
      SLO_POLICY_RELIABILITY_FIRST_TIER_NAME,
      SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME,
    ]);
  });
});
