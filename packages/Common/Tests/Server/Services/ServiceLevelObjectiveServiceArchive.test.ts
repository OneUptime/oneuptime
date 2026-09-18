import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import ServiceLevelObjectiveService, {
  SLO_ARCHIVED_ROOT_CAUSE,
  SLO_DISABLED_OR_DELETED_ROOT_CAUSE,
} from "../../../Server/Services/ServiceLevelObjectiveService";
import ServiceLevelObjectiveBurnRateRuleService from "../../../Server/Services/ServiceLevelObjectiveBurnRateRuleService";
import ServiceLevelObjectiveFeedService from "../../../Server/Services/ServiceLevelObjectiveFeedService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test: what archiving an SLO does on the server.
 *
 *   - an archived SLO is never due for evaluation, independently of whether it
 *     is enabled (the two flags are separate on purpose),
 *   - archiving resolves everything the SLO's burn-rate rules left open, with a
 *     root cause that says "archived" - the worker will never look at the SLO
 *     again, so nothing else would ever close those records,
 *   - a single write that both disables and archives resolves ONCE, with the
 *     archive wording,
 *   - unarchiving resolves nothing but forces a re-evaluation stamp, so the
 *     frozen status refreshes on the next tick,
 *   - none of that can fail the user's write,
 *   - and the resolve's new rootCause parameter reaches every rule while its
 *     default stays the exact text every existing caller relies on.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SLO_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_SLO_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const USER_ID: ObjectID = new ObjectID("99999999-9999-4999-8999-999999999999");
const RULE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

interface ResolveArgs {
  sloId: ObjectID;
  projectId: ObjectID;
  rootCause?: string | undefined;
}

interface UpdateOneByIdArgs {
  id: ObjectID;
  data: Record<string, unknown>;
  props: Record<string, unknown>;
}

interface RuleResolveArgs {
  serviceLevelObjectiveId: ObjectID;
  burnRateRuleId: ObjectID;
  projectId: ObjectID;
  rootCause: string;
}

type HookFunction = (...hookArgs: Array<unknown>) => Promise<unknown>;

// Calls the protected hook without widening the service's public surface.
function callHook(name: string, ...args: Array<unknown>): Promise<unknown> {
  const hooks: Record<string, HookFunction> =
    ServiceLevelObjectiveService as unknown as Record<string, HookFunction>;

  return hooks[name]!.apply(ServiceLevelObjectiveService, args);
}

function makeSlo(fields: Record<string, unknown>): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  const writable: Record<string, unknown> = slo as unknown as Record<
    string,
    unknown
  >;

  for (const key of Object.keys(fields)) {
    writable[key] = fields[key];
  }

  return slo;
}

/*
 * A dashboard user's write, not a root one: archiving is something a person
 * does from Settings or the bulk action bar.
 */
function makeOnUpdate(
  data: Record<string, unknown>,
): OnUpdate<ServiceLevelObjective> {
  return {
    updateBy: {
      query: { _id: SLO_ID.toString() },
      data: data,
      props: { tenantId: PROJECT_ID, userId: USER_ID },
      limit: 1,
      skip: 0,
    } as unknown as UpdateBy<ServiceLevelObjective>,
    carryForward: null,
  };
}

function makeRule(id: ObjectID): ServiceLevelObjectiveBurnRateRule {
  const rule: ServiceLevelObjectiveBurnRateRule =
    new ServiceLevelObjectiveBurnRateRule();
  rule._id = id.toString();
  rule.id = id;
  rule.projectId = PROJECT_ID;
  rule.serviceLevelObjectiveId = SLO_ID;
  return rule;
}

function resolveCalls(spy: jest.SpyInstance): Array<ResolveArgs> {
  return spy.mock.calls.map((args: Array<unknown>): ResolveArgs => {
    return args[0] as ResolveArgs;
  });
}

// Only the re-evaluation stamps: the hook is free to write other columns.
function reEvaluationStamps(spy: jest.SpyInstance): Array<UpdateOneByIdArgs> {
  return spy.mock.calls
    .map((args: Array<unknown>): UpdateOneByIdArgs => {
      return args[0] as UpdateOneByIdArgs;
    })
    .filter((args: UpdateOneByIdArgs): boolean => {
      return Object.prototype.hasOwnProperty.call(
        args.data,
        "nextEvaluationAt",
      );
    });
}

describe("ServiceLevelObjectiveService.getDueSlos - archived SLOs", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function capturedQuery(): Promise<Record<string, unknown>> {
    const findAllBySpy: jest.SpyInstance = jest
      .spyOn(ServiceLevelObjectiveService, "findAllBy")
      .mockResolvedValue([]);

    await ServiceLevelObjectiveService.getDueSlos();

    expect(findAllBySpy).toHaveBeenCalledTimes(1);

    return (
      findAllBySpy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
  }

  it("never picks up an archived SLO", async () => {
    const query: Record<string, unknown> = await capturedQuery();

    expect(query["isArchived"]).toBe(false);
  });

  it("filters on archived and enabled as two independent flags", async () => {
    const query: Record<string, unknown> = await capturedQuery();

    /*
     * Both, not one standing in for the other: unarchiving must not re-enable
     * an SLO somebody paused, so an unarchived-but-disabled SLO still has to
     * be skipped, and an enabled-but-archived one too.
     */
    expect(query["isEnabled"]).toBe(true);
    expect(query["isArchived"]).toBe(false);
  });
});

describe("ServiceLevelObjectiveService.onUpdateSuccess - archive and unarchive", () => {
  let resolveSpy: jest.SpyInstance;
  let updateOneByIdSpy: jest.SpyInstance;
  let findOneByIdSpy: jest.SpyInstance;

  beforeEach(() => {
    resolveSpy = jest
      .spyOn(
        ServiceLevelObjectiveService,
        "resolveOpenBurnRateAlertsAndIncidentsForSlo",
      )
      .mockResolvedValue(undefined);

    updateOneByIdSpy = jest
      .spyOn(ServiceLevelObjectiveService, "updateOneById")
      .mockResolvedValue(1);

    findOneByIdSpy = jest
      .spyOn(ServiceLevelObjectiveService, "findOneById")
      .mockResolvedValue(makeSlo({ projectId: PROJECT_ID }));

    /*
     * Collaborators other hooks in onUpdateSuccess may reach; stubbed so this
     * suite never touches a database whatever else the hook grows.
     */
    jest
      .spyOn(
        ServiceLevelObjectiveFeedService,
        "createServiceLevelObjectiveFeedItem",
      )
      .mockResolvedValue(undefined);

    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("resolves every archived SLO's open burn-rate outputs with the archive root cause", async () => {
    await callHook("onUpdateSuccess", makeOnUpdate({ isArchived: true }), [
      SLO_ID,
      OTHER_SLO_ID,
    ]);

    expect(resolveSpy).toHaveBeenCalledTimes(2);
    expect(resolveCalls(resolveSpy)).toEqual([
      {
        sloId: SLO_ID,
        projectId: PROJECT_ID,
        rootCause: SLO_ARCHIVED_ROOT_CAUSE,
      },
      {
        sloId: OTHER_SLO_ID,
        projectId: PROJECT_ID,
        rootCause: SLO_ARCHIVED_ROOT_CAUSE,
      },
    ]);
  });

  it("says 'archived' in the root cause, distinct from the disable wording", () => {
    expect(SLO_ARCHIVED_ROOT_CAUSE).toBe(
      "Auto-resolved because the Service Level Objective was archived.",
    );
    expect(SLO_ARCHIVED_ROOT_CAUSE).not.toBe(
      SLO_DISABLED_OR_DELETED_ROOT_CAUSE,
    );
  });

  it("looks up each archived SLO's project as root before resolving", async () => {
    await callHook("onUpdateSuccess", makeOnUpdate({ isArchived: true }), [
      SLO_ID,
    ]);

    expect(findOneByIdSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: SLO_ID,
        props: { isRoot: true },
      }),
    );
  });

  it("resolves ONCE, with the archive wording, when one write both disables and archives", async () => {
    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({ isEnabled: false, isArchived: true }),
      [SLO_ID],
    );

    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(resolveCalls(resolveSpy)[0]).toEqual({
      sloId: SLO_ID,
      projectId: PROJECT_ID,
      rootCause: SLO_ARCHIVED_ROOT_CAUSE,
    });
  });

  it("keeps a plain disable on exactly its old payload, with no rootCause key at all", async () => {
    await callHook("onUpdateSuccess", makeOnUpdate({ isEnabled: false }), [
      SLO_ID,
    ]);

    expect(resolveSpy).toHaveBeenCalledTimes(1);

    const args: ResolveArgs = resolveCalls(resolveSpy)[0]!;

    expect(Object.keys(args).sort()).toEqual(["projectId", "sloId"]);
  });

  it("does not force a re-evaluation when archiving - the worker is about to stop looking", async () => {
    await callHook("onUpdateSuccess", makeOnUpdate({ isArchived: true }), [
      SLO_ID,
    ]);

    expect(reEvaluationStamps(updateOneByIdSpy)).toEqual([]);
  });

  it("unarchiving resolves nothing and stamps nextEvaluationAt = now, as root, for every id", async () => {
    const before: number = Date.now();

    await callHook("onUpdateSuccess", makeOnUpdate({ isArchived: false }), [
      SLO_ID,
      OTHER_SLO_ID,
    ]);

    const after: number = Date.now();

    expect(resolveSpy).not.toHaveBeenCalled();

    const stamps: Array<UpdateOneByIdArgs> =
      reEvaluationStamps(updateOneByIdSpy);

    expect(
      stamps.map((stamp: UpdateOneByIdArgs): string => {
        return stamp.id.toString();
      }),
    ).toEqual([SLO_ID.toString(), OTHER_SLO_ID.toString()]);

    for (const stamp of stamps) {
      expect(stamp.props).toEqual({ isRoot: true });

      const nextEvaluationAt: Date = stamp.data["nextEvaluationAt"] as Date;

      expect(nextEvaluationAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(nextEvaluationAt.getTime()).toBeLessThanOrEqual(after);
    }
  });

  it("stamps once when an unarchive is bundled with another re-evaluation trigger", async () => {
    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({ isArchived: false, windowDays: 7 }),
      [SLO_ID],
    );

    expect(reEvaluationStamps(updateOneByIdSpy)).toHaveLength(1);
  });

  it("restoring and re-enabling in one write still resolves nothing", async () => {
    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({ isArchived: false, isEnabled: true }),
      [SLO_ID],
    );

    expect(resolveSpy).not.toHaveBeenCalled();
    expect(reEvaluationStamps(updateOneByIdSpy)).toHaveLength(1);
  });

  it("swallows a throwing resolve for one archived SLO and still resolves the rest", async () => {
    resolveSpy
      .mockRejectedValueOnce(new Error("alert service down"))
      .mockResolvedValueOnce(undefined);

    const onUpdate: OnUpdate<ServiceLevelObjective> = makeOnUpdate({
      isArchived: true,
    });

    await expect(
      callHook("onUpdateSuccess", onUpdate, [SLO_ID, OTHER_SLO_ID]),
    ).resolves.toBe(onUpdate);

    expect(resolveSpy).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalled();
  });

  it("swallows a failed project lookup for an archived SLO instead of failing the archive", async () => {
    findOneByIdSpy.mockRejectedValue(new Error("db connection reset"));

    const onUpdate: OnUpdate<ServiceLevelObjective> = makeOnUpdate({
      isArchived: true,
    });

    await expect(callHook("onUpdateSuccess", onUpdate, [SLO_ID])).resolves.toBe(
      onUpdate,
    );

    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it("skips an archived SLO row it cannot re-read", async () => {
    findOneByIdSpy.mockResolvedValue(null);

    await callHook("onUpdateSuccess", makeOnUpdate({ isArchived: true }), [
      SLO_ID,
    ]);

    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it("swallows a failed unarchive stamp instead of failing the unarchive", async () => {
    updateOneByIdSpy.mockRejectedValue(new Error("db down"));

    const onUpdate: OnUpdate<ServiceLevelObjective> = makeOnUpdate({
      isArchived: false,
    });

    await expect(callHook("onUpdateSuccess", onUpdate, [SLO_ID])).resolves.toBe(
      onUpdate,
    );
  });

  it("neither resolves nor stamps when the write does not touch isArchived", async () => {
    await callHook(
      "onUpdateSuccess",
      makeOnUpdate({ description: "a doc tweak" }),
      [SLO_ID],
    );

    expect(resolveSpy).not.toHaveBeenCalled();
    expect(reEvaluationStamps(updateOneByIdSpy)).toEqual([]);
  });
});

describe("ServiceLevelObjectiveService.resolveOpenBurnRateAlertsAndIncidentsForSlo - rootCause", () => {
  let findRulesSpy: jest.SpyInstance;
  let resolveRuleSpy: jest.SpyInstance;

  beforeEach(() => {
    findRulesSpy = jest
      .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
      .mockResolvedValue([makeRule(RULE_ID), makeRule(OTHER_RULE_ID)]);

    resolveRuleSpy = jest
      .spyOn(
        ServiceLevelObjectiveBurnRateRuleService,
        "resolveOpenAlertsAndIncidentsForRule",
      )
      .mockResolvedValue(undefined);

    jest
      .spyOn(
        ServiceLevelObjectiveBurnRateRuleService,
        "clearOpenOutputStateForRule",
      )
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function ruleRootCauses(): Array<string> {
    return resolveRuleSpy.mock.calls.map((args: Array<unknown>): string => {
      return (args[0] as RuleResolveArgs).rootCause;
    });
  }

  it("hands a supplied root cause to every rule", async () => {
    await ServiceLevelObjectiveService.resolveOpenBurnRateAlertsAndIncidentsForSlo(
      {
        sloId: SLO_ID,
        projectId: PROJECT_ID,
        rootCause: SLO_ARCHIVED_ROOT_CAUSE,
      },
    );

    expect(ruleRootCauses()).toEqual([
      SLO_ARCHIVED_ROOT_CAUSE,
      SLO_ARCHIVED_ROOT_CAUSE,
    ]);
  });

  it("keeps the exact disable/delete wording when no root cause is supplied", async () => {
    await ServiceLevelObjectiveService.resolveOpenBurnRateAlertsAndIncidentsForSlo(
      {
        sloId: SLO_ID,
        projectId: PROJECT_ID,
      },
    );

    /*
     * Spelled out rather than read from the constant: the worker's guard path
     * and the delete hook have always stamped this text, and changing it would
     * change what every existing resolved record's successors say.
     */
    expect(ruleRootCauses()).toEqual([
      "Auto-resolved because the Service Level Objective was disabled or deleted.",
      "Auto-resolved because the Service Level Objective was disabled or deleted.",
    ]);
  });

  it("falls back to the default for an empty root cause rather than stamping a blank one", async () => {
    await ServiceLevelObjectiveService.resolveOpenBurnRateAlertsAndIncidentsForSlo(
      {
        sloId: SLO_ID,
        projectId: PROJECT_ID,
        rootCause: "",
      },
    );

    expect(ruleRootCauses()).toEqual([
      SLO_DISABLED_OR_DELETED_ROOT_CAUSE,
      SLO_DISABLED_OR_DELETED_ROOT_CAUSE,
    ]);
  });

  it("the root cause changes nothing about which rules are resolved", async () => {
    await ServiceLevelObjectiveService.resolveOpenBurnRateAlertsAndIncidentsForSlo(
      {
        sloId: SLO_ID,
        projectId: PROJECT_ID,
        rootCause: SLO_ARCHIVED_ROOT_CAUSE,
      },
    );

    const findArgs: { query: Record<string, unknown> } = findRulesSpy.mock
      .calls[0]![0] as { query: Record<string, unknown> };

    expect(findArgs.query["serviceLevelObjectiveId"]).toEqual(SLO_ID);
    expect(findArgs.query["projectId"]).toEqual(PROJECT_ID);

    const ruleIds: Array<string> = resolveRuleSpy.mock.calls.map(
      (args: Array<unknown>): string => {
        return (args[0] as RuleResolveArgs).burnRateRuleId.toString();
      },
    );

    expect(ruleIds).toEqual([RULE_ID.toString(), OTHER_RULE_ID.toString()]);
  });

  it("still attempts every rule and rethrows the first failure with a custom root cause", async () => {
    resolveRuleSpy
      .mockRejectedValueOnce(new Error("first rule failed"))
      .mockResolvedValueOnce(undefined);

    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });

    await expect(
      ServiceLevelObjectiveService.resolveOpenBurnRateAlertsAndIncidentsForSlo({
        sloId: SLO_ID,
        projectId: PROJECT_ID,
        rootCause: SLO_ARCHIVED_ROOT_CAUSE,
      }),
    ).rejects.toThrow("first rule failed");

    expect(resolveRuleSpy).toHaveBeenCalledTimes(2);
  });
});
