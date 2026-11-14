import ServiceLevelObjectiveErrorBudgetPolicyTier from "../../../Models/DatabaseModels/ServiceLevelObjectiveErrorBudgetPolicyTier";
import ServiceLevelObjectiveErrorBudgetPolicyTierService, {
  SLO_POLICY_TIER_THRESHOLD_ERROR_MESSAGE,
  SloAddedRecommendedPolicyTier,
  SloAddedRecommendedPolicyTiers,
} from "../../../Server/Services/ServiceLevelObjectiveErrorBudgetPolicyTierService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import logger from "../../../Server/Utils/Logger";
import SloRecordReferenceValidator from "../../../Server/Utils/Slo/SloRecordReferenceValidator";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME,
  SLO_RECOMMENDED_POLICY_TIERS,
  SloRecommendedPolicyTier,
  areSloDeploymentsAllowedInTier,
  computeSloPolicyTier,
  readSloPolicyTierThreshold,
} from "../../../Utils/Slo/SloErrorBudgetPolicy";
import { customDomainCaller } from "../API/CustomDomainCallers";
import InMemoryLocks from "../TestingUtils/InMemoryLocks";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * AN ERROR BUDGET POLICY TIER AT 0% IS A TIER (#6978).
 *
 * 0% is the tier of an exhausted budget: the recommended policy ends with
 * it (Budget exhausted, the tier that freezes deployments), and the form and
 * the docs say a threshold runs from 0 to 100. The required-column check of
 * every create read 0 as missing, so a tier at 0% was refused as
 * "thresholdPercentage is required" - added by hand, through the API, and by
 * "Use the recommended policy", which stopped after adding its first two
 * tiers. The SLO was left with half a policy, without the tier that freezes
 * deployments, and the page no longer offered the recommended policy to
 * finish it: it offers it only to an SLO with no tier.
 *
 * These drive the real create - its hooks, its permission checks and its
 * required-column check - over tables in memory, which is where the unit
 * tests of the recommended policy, with create stubbed, could not see it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "69780000-0000-4000-8000-000000000001",
);
const SLO_ID: ObjectID = new ObjectID("69780000-0000-4000-8000-000000000002");
const OTHER_TIER_ID: ObjectID = new ObjectID(
  "69780000-0000-4000-8000-000000000003",
);

const TierService: typeof ServiceLevelObjectiveErrorBudgetPolicyTierService =
  ServiceLevelObjectiveErrorBudgetPolicyTierService;

function sloRow(): StoredRow {
  return {
    _id: SLO_ID.toString(),
    projectId: PROJECT_ID.toString(),
    name: "Checkout availability",
    targetPercentage: 99.9,
    isEnabled: true,
    isArchived: false,
    version: 1,
  };
}

// Whoever manages the SLO's policy: they may add, read and remove tiers.
function policyEditor(): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({
      projectId: PROJECT_ID,
      permissions: [
        Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
        Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
        Permission.EditServiceLevelObjectiveErrorBudgetPolicyTier,
        Permission.DeleteServiceLevelObjectiveErrorBudgetPolicyTier,
        Permission.ReadServiceLevelObjective,
      ],
    }),
    ...ON_HIGHEST_PLAN,
  };
}

// Someone who may add tiers, and read them, but not remove them.
function tierAdder(): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({
      projectId: PROJECT_ID,
      permissions: [
        Permission.CreateServiceLevelObjectiveErrorBudgetPolicyTier,
        Permission.ReadServiceLevelObjectiveErrorBudgetPolicyTier,
        Permission.ReadServiceLevelObjective,
      ],
    }),
    ...ON_HIGHEST_PLAN,
  };
}

function tierOf(fields: {
  name?: string;
  thresholdPercentage?: unknown;
  whatWeDo?: string;
  freezesDeployments?: boolean;
}): ServiceLevelObjectiveErrorBudgetPolicyTier {
  const tier: ServiceLevelObjectiveErrorBudgetPolicyTier =
    new ServiceLevelObjectiveErrorBudgetPolicyTier();
  tier.projectId = PROJECT_ID;
  tier.serviceLevelObjectiveId = SLO_ID;
  tier.name = "Budget exhausted";
  tier.whatWeDo = "Only reliability and security fixes ship.";

  for (const [column, value] of Object.entries(fields)) {
    (tier as unknown as StoredRow)[column] = value;
  }

  return tier;
}

function namesOf(table: InMemoryTable): Array<string> {
  return table.rows.map((row: StoredRow): string => {
    return String(row["name"]);
  });
}

function rowNamed(table: InMemoryTable, name: string): StoredRow {
  const row: StoredRow | undefined = table.rows.find((candidate: StoredRow) => {
    return candidate["name"] === name;
  });

  if (!row) {
    throw new Error(`No tier named ${name}: ${namesOf(table).join(", ")}`);
  }

  return row;
}

async function refusalOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }

  throw new Error("Expected the write to be refused, but it went through.");
}

let tiers: InMemoryTable;
let locks: InMemoryLocks;
// Each "evaluate this SLO on the next tick" a tier's change asks for.
let evaluationRequests: ReturnType<typeof getJestSpyOn>;

/*
 * The SLO, where each part of a tier's create reads it: the SLO service and
 * the plain lookup the reference check uses. Asking for an evaluation is a
 * hookless UPDATE of the SLO's nextEvaluationAt, recorded here.
 */
function useSlo(): void {
  useInMemoryTable(ServiceLevelObjectiveService, [sloRow()]);
  useInMemoryTable(SloRecordReferenceValidator.getLookupService(), [sloRow()]);
  evaluationRequests = getJestSpyOn(
    ServiceLevelObjectiveService,
    "updateColumnsByIdWithoutHooks",
  ).mockResolvedValue(undefined as never);
  stubProjectDirectory({});
}

// Lets the fire-and-forget work a create starts after it returns finish.
async function settle(): Promise<void> {
  for (let turn: number = 0; turn < 10; turn++) {
    await Promise.resolve();
  }
}

// The SLOs a change asked to be evaluated, in order.
function sloIdsAskedToBeEvaluated(): Array<string> {
  return evaluationRequests.mock.calls.map((call: Array<unknown>): string => {
    const update: { id: ObjectID; data: Record<string, unknown> } = call[0] as {
      id: ObjectID;
      data: Record<string, unknown>;
    };

    expect(update.data["nextEvaluationAt"]).toBeInstanceOf(Date);

    return update.id.toString();
  });
}

beforeEach(() => {
  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  tiers = useInMemoryTable(TierService, []);
  useSlo();

  locks = new InMemoryLocks();
  locks.install();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a tier at 0%, added by hand", () => {
  test("is created, with the threshold 0", async () => {
    await TierService.create({
      data: tierOf({ thresholdPercentage: 0, freezesDeployments: true }),
      props: policyEditor(),
    });

    expect(tiers.inserts).toHaveLength(1);
    expect(
      readSloPolicyTierThreshold(tiers.inserts[0]!["thresholdPercentage"]),
    ).toBe(0);
    expect(tiers.inserts[0]!["freezesDeployments"]).toBe(true);
  });

  test("is created from the Dashboard's number field, which sends it as text", async () => {
    await TierService.create({
      data: tierOf({ thresholdPercentage: "0" }),
      props: policyEditor(),
    });

    expect(tiers.inserts).toHaveLength(1);
    expect(tiers.inserts[0]!["thresholdPercentage"]).toBe(0);
  });

  test("is created by OneUptime itself (root) too", async () => {
    await TierService.create({
      data: tierOf({ thresholdPercentage: 0 }),
      props: { isRoot: true, tenantId: PROJECT_ID },
    });

    expect(tiers.inserts).toHaveLength(1);
  });

  test.each([[0.5], [25], [100]])(
    "and so are the other thresholds from 0 to 100: %p",
    async (threshold: number) => {
      await TierService.create({
        data: tierOf({ thresholdPercentage: threshold }),
        props: policyEditor(),
      });

      expect(tiers.inserts).toHaveLength(1);
      expect(tiers.inserts[0]!["thresholdPercentage"]).toBe(threshold);
    },
  );

  test.each([
    ["no threshold", undefined],
    ["null", null],
    ["an empty number field", ""],
    ["text that is no number", "none"],
    ["below 0", -1],
    ["above 100", 100.5],
  ] as Array<[string, unknown]>)(
    "%s is still refused, in the tier's own words",
    async (_what: string, threshold: unknown) => {
      const error: Error = await refusalOf(
        TierService.create({
          data: tierOf({ thresholdPercentage: threshold }),
          props: policyEditor(),
        }),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect(error.message).toBe(SLO_POLICY_TIER_THRESHOLD_ERROR_MESSAGE);
      expect(tiers.inserts).toHaveLength(0);
    },
  );

  test("the tier's other required columns are still required", async () => {
    const tier: ServiceLevelObjectiveErrorBudgetPolicyTier = tierOf({
      thresholdPercentage: 0,
    });
    delete (tier as unknown as StoredRow)["serviceLevelObjectiveId"];

    const error: Error = await refusalOf(
      TierService.create({ data: tier, props: { isRoot: true } }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect(tiers.inserts).toHaveLength(0);
  });

  test("a second tier at 0% on the same SLO is refused as a duplicate, not as missing", async () => {
    await TierService.create({
      data: tierOf({ thresholdPercentage: 0 }),
      props: policyEditor(),
    });

    const error: Error = await refusalOf(
      TierService.create({
        data: tierOf({ name: "Frozen", thresholdPercentage: 0 }),
        props: policyEditor(),
      }),
    );

    expect(error.message).toContain("already has a tier at 0%");
    expect(tiers.inserts).toHaveLength(1);
  });

  test("asks for the SLO to be evaluated, so a spent budget enters it within a minute", async () => {
    await TierService.create({
      data: tierOf({ thresholdPercentage: 0 }),
      props: policyEditor(),
    });

    await settle();

    expect(sloIdsAskedToBeEvaluated()).toEqual([SLO_ID.toString()]);
  });
});

describe("Use the recommended policy", () => {
  test("adds all three tiers, Budget exhausted at 0% with deployments frozen", async () => {
    const added: SloAddedRecommendedPolicyTiers =
      await TierService.addMissingRecommendedTiers({
        serviceLevelObjectiveId: SLO_ID,
        props: policyEditor(),
      });

    expect(
      added.tiers.map((tier: SloRecommendedPolicyTier) => {
        return [tier.name, tier.thresholdPercentage, tier.freezesDeployments];
      }),
    ).toEqual([
      ["Caution", 50, false],
      ["Reliability first", 25, false],
      ["Budget exhausted", 0, true],
    ]);

    expect(namesOf(tiers)).toEqual(
      SLO_RECOMMENDED_POLICY_TIERS.map((tier: SloRecommendedPolicyTier) => {
        return tier.name;
      }),
    );

    const exhausted: StoredRow = rowNamed(
      tiers,
      SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME,
    );
    expect(readSloPolicyTierThreshold(exhausted["thresholdPercentage"])).toBe(
      0,
    );
    expect(exhausted["freezesDeployments"]).toBe(true);
    expect(exhausted["isEnabled"]).toBe(true);
    // Created as the caller, as a tier added by hand would be.
    expect(
      added.tiers.every((tier: SloAddedRecommendedPolicyTier) => {
        return tier.tierId !== null;
      }),
    ).toBe(true);
  });

  test("so an SLO whose budget is spent is in Budget exhausted, and its deployments freeze", async () => {
    await TierService.addMissingRecommendedTiers({
      serviceLevelObjectiveId: SLO_ID,
      props: policyEditor(),
    });

    const tier: StoredRow | null = computeSloPolicyTier({
      budgetRemainingPercentage: 0,
      tiers: tiers.rows.map((row: StoredRow) => {
        return {
          id: String(row["_id"]),
          thresholdPercentage: row["thresholdPercentage"] as number,
          freezesDeployments: row["freezesDeployments"] as boolean,
          name: row["name"],
        };
      }),
      currentTierId: null,
    }) as StoredRow | null;

    expect(tier?.["name"]).toBe(SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME);
    expect(
      areSloDeploymentsAllowedInTier(
        tier as { freezesDeployments?: boolean | null },
      ),
    ).toBe(false);
  });

  test("asking again adds nothing", async () => {
    await TierService.addMissingRecommendedTiers({
      serviceLevelObjectiveId: SLO_ID,
      props: policyEditor(),
    });

    const second: SloAddedRecommendedPolicyTiers =
      await TierService.addMissingRecommendedTiers({
        serviceLevelObjectiveId: SLO_ID,
        props: policyEditor(),
      });

    expect(second.tiers).toEqual([]);
    expect(tiers.inserts).toHaveLength(3);
  });

  test("an SLO with the first two tiers - the half policy #6978 left - gets Budget exhausted", async () => {
    await TierService.addMissingRecommendedTiers({
      serviceLevelObjectiveId: SLO_ID,
      props: policyEditor(),
    });
    tiers.rows = tiers.rows.filter((row: StoredRow) => {
      return row["name"] !== SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME;
    });

    const added: SloAddedRecommendedPolicyTiers =
      await TierService.addMissingRecommendedTiers({
        serviceLevelObjectiveId: SLO_ID,
        props: policyEditor(),
      });

    expect(
      added.tiers.map((tier: SloRecommendedPolicyTier) => {
        return tier.name;
      }),
    ).toEqual([SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME]);
    expect(
      rowNamed(tiers, SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME)[
        "freezesDeployments"
      ],
    ).toBe(true);
  });
});

describe("Use the recommended policy adds the whole policy or nothing", () => {
  // The create of the tier named `name` fails, as a database outage would.
  function failCreateOf(name: string, error: Error): void {
    const create: typeof TierService.create =
      TierService.create.bind(TierService);

    getJestSpyOn(TierService, "create").mockImplementation((async (createBy: {
      data: ServiceLevelObjectiveErrorBudgetPolicyTier;
    }) => {
      if (createBy.data.name === name) {
        throw error;
      }

      return await create(createBy as never);
    }) as never);
  }

  test("a tier that fails takes the ones added before it back out, and the refusal is passed on", async () => {
    failCreateOf(
      SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME,
      new BadDataException("The database went away."),
    );

    const error: Error = await refusalOf(
      TierService.addMissingRecommendedTiers({
        serviceLevelObjectiveId: SLO_ID,
        props: policyEditor(),
      }),
    );

    expect(error.message).toBe("The database went away.");
    expect(tiers.inserts).toHaveLength(2);
    expect(tiers.deletes).toEqual(
      tiers.inserts.map((row: StoredRow): string => {
        return String(row["_id"]);
      }),
    );
    expect(tiers.rows).toEqual([]);

    /*
     * Through the delete's hooks, as removing a tier by hand: each removal
     * asks for the SLO to be evaluated again, after each create did.
     */
    await settle();
    expect(sloIdsAskedToBeEvaluated()).toEqual([
      SLO_ID.toString(),
      SLO_ID.toString(),
      SLO_ID.toString(),
      SLO_ID.toString(),
    ]);
  });

  test("removed even for someone who may add tiers but not remove them", async () => {
    failCreateOf(
      SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME,
      new BadDataException("The database went away."),
    );

    await refusalOf(
      TierService.addMissingRecommendedTiers({
        serviceLevelObjectiveId: SLO_ID,
        props: tierAdder(),
      }),
    );

    expect(tiers.inserts).toHaveLength(2);
    expect(tiers.rows).toEqual([]);
  });

  test("leaves a tier somebody else added alone", async () => {
    tiers.rows.push({
      _id: OTHER_TIER_ID.toString(),
      projectId: PROJECT_ID.toString(),
      serviceLevelObjectiveId: SLO_ID.toString(),
      name: "Heads up",
      thresholdPercentage: 75,
      whatWeDo: "Look at what is spending the budget.",
      isEnabled: true,
      version: 1,
    });
    failCreateOf(
      SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME,
      new BadDataException("The database went away."),
    );

    await refusalOf(
      TierService.addMissingRecommendedTiers({
        serviceLevelObjectiveId: SLO_ID,
        props: policyEditor(),
      }),
    );

    expect(namesOf(tiers)).toEqual(["Heads up"]);
  });

  test("so asking again, once the failure has passed, adds all three", async () => {
    failCreateOf(
      SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME,
      new BadDataException("The database went away."),
    );

    await refusalOf(
      TierService.addMissingRecommendedTiers({
        serviceLevelObjectiveId: SLO_ID,
        props: policyEditor(),
      }),
    );

    jest.restoreAllMocks();
    tiers = useInMemoryTable(TierService, tiers.rows);
    useSlo();
    locks = new InMemoryLocks();
    locks.install();

    const added: SloAddedRecommendedPolicyTiers =
      await TierService.addMissingRecommendedTiers({
        serviceLevelObjectiveId: SLO_ID,
        props: policyEditor(),
      });

    expect(added.tiers).toHaveLength(3);
    expect(tiers.rows).toHaveLength(3);
  });

  test("the first tier failing adds nothing and removes nothing", async () => {
    failCreateOf("Caution", new BadDataException("The database went away."));

    await refusalOf(
      TierService.addMissingRecommendedTiers({
        serviceLevelObjectiveId: SLO_ID,
        props: policyEditor(),
      }),
    );

    expect(tiers.inserts).toHaveLength(0);
    expect(tiers.deletes).toHaveLength(0);
  });

  test("a tier that cannot be removed is logged, and the create's refusal is still the one passed on", async () => {
    failCreateOf(
      SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME,
      new BadDataException("The database went away."),
    );
    getJestSpyOn(TierService, "deleteOneBy").mockRejectedValue(
      new Error("Still away."),
    );

    const error: Error = await refusalOf(
      TierService.addMissingRecommendedTiers({
        serviceLevelObjectiveId: SLO_ID,
        props: policyEditor(),
      }),
    );

    expect(error.message).toBe("The database went away.");
    expect(tiers.rows).toHaveLength(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "after adding the recommended policy failed; the SLO keeps it",
      ),
      expect.anything(),
    );
  });

  test("the removals happen under the lock, before a request waiting for it reads the SLO", async () => {
    failCreateOf(
      SLO_POLICY_BUDGET_EXHAUSTED_TIER_NAME,
      new BadDataException("The database went away."),
    );

    await refusalOf(
      TierService.addMissingRecommendedTiers({
        serviceLevelObjectiveId: SLO_ID,
        props: policyEditor(),
      }),
    );

    expect(locks.eventsOf("lock")).toHaveLength(1);
    expect(locks.eventsOf("release")).toHaveLength(1);
    expect(tiers.rows).toEqual([]);
  });
});
