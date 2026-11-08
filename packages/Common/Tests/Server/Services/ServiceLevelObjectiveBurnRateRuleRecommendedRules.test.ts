import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import ServiceLevelObjectiveBurnRateRuleService, {
  SLO_NOT_FOUND_MESSAGE,
  SloAddedRecommendedRules,
  SloMissingRecommendedRules,
} from "../../../Server/Services/ServiceLevelObjectiveBurnRateRuleService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import logger from "../../../Server/Utils/Logger";
import SloFeedUtil from "../../../Server/Utils/Slo/SloFeedUtil";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import UserType from "../../../Types/UserType";
import {
  SLO_FAST_BURN_RULE_NAME,
  SLO_SLOW_BURN_RULE_NAME,
  SLO_SLOW_LEAK_RULE_NAME,
  SloRecommendedAlertSeverity,
  SloRecommendedBurnRateRule,
  getSloRecommendedBurnRateRules,
} from "../../../Utils/Slo/SloRecommendedBurnRateRules";
import InMemoryLocks from "../TestingUtils/InMemoryLocks";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * "Add recommended rules" on the server: which of the recommended burn rate
 * rules (Fast burn, Slow burn, Slow leak) an SLO is missing, and adding them.
 *
 * What is pinned:
 *
 *   - the SLO is read AS THE CALLER, so an SLO they may not read - or one of
 *     another project - is not found, and nothing is added for it;
 *   - what is missing is worked out from EVERY rule of the SLO (a root read
 *     pinned to the SLO and its project), scaled to the SLO's window;
 *   - Slow leak raises at the project's least severe severity, the others at
 *     the most severe;
 *   - each missing rule is created through create() with the caller's own
 *     props - so the same permission checks, hooks, feed item and audit log
 *     apply as to a rule created by hand - and outside the seeding flag, so
 *     its "rule added" item is posted;
 *   - it is idempotent: a second request finds nothing missing, and two
 *     requests at once are serialised by a lock per SLO so neither adds a
 *     rule twice.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SLO_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const CRITICAL_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const LOW_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");

const LOCK_NAMESPACE: string =
  "ServiceLevelObjectiveBurnRateRuleService.addMissingRecommendedRules";

function caller(): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [
          Permission.CreateServiceLevelObjectiveBurnRateRule,
          Permission.ReadServiceLevelObjectiveBurnRateRule,
          Permission.ReadServiceLevelObjective,
        ].map((permission: Permission): UserPermission => {
          return {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          };
        }),
      },
    },
  };
}

function severity(id: ObjectID, name: string, order: number): AlertSeverity {
  const row: AlertSeverity = new AlertSeverity();
  row._id = id.toString();
  row.id = id;
  row.name = name;
  row.order = order;
  return row;
}

function sloWith(
  window: { windowType?: SloWindowType; windowDays?: number } = {
    windowType: SloWindowType.Rolling,
    windowDays: 30,
  },
): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo._id = SLO_ID.toString();
  slo.id = SLO_ID;
  slo.projectId = PROJECT_ID;

  if (window.windowType) {
    slo.windowType = window.windowType;
  }

  if (window.windowDays !== undefined) {
    slo.windowDays = window.windowDays;
  }

  return slo;
}

function existingRule(
  name: string,
  longWindowInMinutes: number,
): ServiceLevelObjectiveBurnRateRule {
  const rule: ServiceLevelObjectiveBurnRateRule =
    new ServiceLevelObjectiveBurnRateRule();
  rule._id = ObjectID.generate().toString();
  rule.name = name;
  rule.longWindowInMinutes = longWindowInMinutes;
  return rule;
}

// The rules an SLO created before Slow leak existed was given.
function upgradedRules(): Array<ServiceLevelObjectiveBurnRateRule> {
  return [existingRule("Fast burn", 60), existingRule("Slow burn", 360)];
}

let storedSlo: ServiceLevelObjective | null;
let storedRules: Array<ServiceLevelObjectiveBurnRateRule>;
let sloReadSpy: jest.SpyInstance;
let ruleReadSpy: jest.SpyInstance;
let severityReadSpy: jest.SpyInstance;
let createSpy: jest.SpyInstance;
let seedingFlagsAtCreate: Array<boolean>;
let locks: InMemoryLocks;

beforeEach(() => {
  storedSlo = sloWith();
  storedRules = upgradedRules();
  seedingFlagsAtCreate = [];

  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });

  sloReadSpy = jest
    .spyOn(ServiceLevelObjectiveService, "findOneBy")
    .mockImplementation((async (): Promise<ServiceLevelObjective | null> => {
      return storedSlo;
    }) as never);

  ruleReadSpy = jest
    .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
    .mockImplementation((async (): Promise<
      Array<ServiceLevelObjectiveBurnRateRule>
    > => {
      return [...storedRules];
    }) as never);

  severityReadSpy = jest
    .spyOn(AlertSeverityService, "findBy")
    .mockResolvedValue([
      severity(LOW_ID, "Low", 4),
      severity(CRITICAL_ID, "Critical", 1),
    ] as never);

  // A created rule is stored, as Postgres would, so the next read sees it.
  createSpy = jest
    .spyOn(ServiceLevelObjectiveBurnRateRuleService, "create")
    .mockImplementation((async (
      createBy: CreateBy<ServiceLevelObjectiveBurnRateRule>,
    ): Promise<ServiceLevelObjectiveBurnRateRule> => {
      seedingFlagsAtCreate.push(
        SloFeedUtil.isSeedingDefaultBurnRateRules(
          createBy.data.serviceLevelObjectiveId,
        ),
      );

      const created: ServiceLevelObjectiveBurnRateRule = createBy.data;
      created._id = ObjectID.generate().toString();
      storedRules.push(created);

      return created;
    }) as never);

  locks = new InMemoryLocks();
  locks.install();
});

afterEach(() => {
  jest.restoreAllMocks();
});

function createdRules(): Array<ServiceLevelObjectiveBurnRateRule> {
  return createSpy.mock.calls.map((call: Array<unknown>) => {
    return (call[0] as CreateBy<ServiceLevelObjectiveBurnRateRule>).data;
  });
}

function namesOf(
  rules: Array<{ recommended: SloRecommendedBurnRateRule }>,
): Array<string> {
  return rules.map((rule: { recommended: SloRecommendedBurnRateRule }) => {
    return rule.recommended.name;
  });
}

describe("the alert severities OneUptime's own rules raise at", () => {
  it("are read once, from the project's severities that are not archived", async () => {
    const severities: {
      mostSevere: AlertSeverity | null;
      leastSevere: AlertSeverity | null;
    } =
      await ServiceLevelObjectiveBurnRateRuleService.getRecommendedRuleAlertSeverities(
        PROJECT_ID,
      );

    expect(severityReadSpy).toHaveBeenCalledTimes(1);
    expect(severityReadSpy.mock.calls[0]![0]).toEqual({
      query: { projectId: PROJECT_ID, isArchived: false },
      select: { _id: true, name: true, order: true },
      sort: { order: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });

    expect(severities.mostSevere?.name).toBe("Critical");
    expect(severities.leastSevere?.name).toBe("Low");
  });

  it("a failed read reaches the caller", async () => {
    severityReadSpy.mockRejectedValue(new Error("severities down"));

    await expect(
      ServiceLevelObjectiveBurnRateRuleService.getRecommendedRuleAlertSeverities(
        PROJECT_ID,
      ),
    ).rejects.toThrow("severities down");
  });
});

describe("a recommended rule as the row OneUptime creates", () => {
  const RULES: Array<SloRecommendedBurnRateRule> =
    getSloRecommendedBurnRateRules({ windowDays: 30 });

  it("carries the recommendation and nothing else", () => {
    const leak: ServiceLevelObjectiveBurnRateRule =
      ServiceLevelObjectiveBurnRateRuleService.buildRecommendedRule({
        projectId: PROJECT_ID,
        serviceLevelObjectiveId: SLO_ID,
        recommended: RULES[2]!,
        alertSeverityId: LOW_ID,
      });

    expect(leak.projectId).toEqual(PROJECT_ID);
    expect(leak.serviceLevelObjectiveId).toEqual(SLO_ID);
    expect(leak.name).toBe("Slow leak");
    expect(leak.isEnabled).toBe(true);
    expect(leak.burnRateThreshold).toBe(1);
    expect(leak.longWindowInMinutes).toBe(4320);
    expect(leak.shortWindowInMinutes).toBe(360);
    expect(leak.refireSuppressionMinutes).toBe(1440);
    expect(leak.alertSeverityId).toEqual(LOW_ID);

    /*
     * The output flags and every option keep their column defaults: an
     * alert, no incident - a ticket - and the built-in text.
     */
    for (const column of [
      "shouldCreateAlert",
      "shouldCreateIncident",
      "incidentSeverityId",
      "minimumSampleCount",
      "alertTitleTemplate",
      "alertDescriptionTemplate",
      "isAlertPrivate",
      "autoResolveAlert",
      "addSloOwnersAsOwners",
      "onCallDutyPolicies",
      "alertLabels",
      "alertOwnerTeams",
      "alertOwnerUsers",
    ]) {
      expect({
        column,
        value: (leak as unknown as Record<string, unknown>)[column],
      }).toEqual({ column, value: undefined });
    }
  });

  it("leaves Fast burn's and Slow burn's re-fire suppression empty: one long window", () => {
    for (const recommended of RULES.slice(0, 2)) {
      expect(
        ServiceLevelObjectiveBurnRateRuleService.buildRecommendedRule({
          projectId: PROJECT_ID,
          serviceLevelObjectiveId: SLO_ID,
          recommended: recommended,
        }).refireSuppressionMinutes,
      ).toBeUndefined();
    }
  });

  it("names no severity when the project has none to pick", () => {
    expect(
      ServiceLevelObjectiveBurnRateRuleService.buildRecommendedRule({
        projectId: PROJECT_ID,
        serviceLevelObjectiveId: SLO_ID,
        recommended: RULES[0]!,
      }).alertSeverityId,
    ).toBeUndefined();
  });
});

describe("which recommended rules an SLO is missing", () => {
  it("reads the SLO as the caller, in the caller's project", async () => {
    const props: DatabaseCommonInteractionProps = caller();

    await ServiceLevelObjectiveBurnRateRuleService.getMissingRecommendedRules({
      serviceLevelObjectiveId: SLO_ID,
      props: props,
    });

    expect(sloReadSpy).toHaveBeenCalledTimes(1);

    const read: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    } = sloReadSpy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: DatabaseCommonInteractionProps;
    };

    expect(read.query).toEqual({
      _id: SLO_ID.toString(),
      projectId: PROJECT_ID,
    });
    expect(read.select).toEqual({
      _id: true,
      projectId: true,
      windowType: true,
      windowDays: true,
    });
    // The caller's own props, never root.
    expect(read.props).toBe(props);
  });

  it("reads every rule of the SLO, whoever asks, pinned to the SLO and its project", async () => {
    await ServiceLevelObjectiveBurnRateRuleService.getMissingRecommendedRules({
      serviceLevelObjectiveId: SLO_ID,
      props: caller(),
    });

    expect(ruleReadSpy).toHaveBeenCalledTimes(1);
    expect(ruleReadSpy.mock.calls[0]![0]).toEqual({
      query: { serviceLevelObjectiveId: SLO_ID, projectId: PROJECT_ID },
      select: { _id: true, name: true, longWindowInMinutes: true },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });
  });

  it("an SLO created before Slow leak existed is missing just Slow leak, at the least severe severity", async () => {
    const missing: SloMissingRecommendedRules =
      await ServiceLevelObjectiveBurnRateRuleService.getMissingRecommendedRules(
        {
          serviceLevelObjectiveId: SLO_ID,
          props: caller(),
        },
      );

    expect(missing.serviceLevelObjectiveId).toEqual(SLO_ID);
    expect(missing.projectId).toEqual(PROJECT_ID);
    expect(missing.rules).toHaveLength(1);
    expect(missing.rules[0]!.recommended).toEqual({
      name: "Slow leak",
      budgetPercentage: 10,
      burnRateThreshold: 1,
      longWindowInMinutes: 4320,
      shortWindowInMinutes: 360,
      refireSuppressionMinutes: 1440,
      alertSeverity: SloRecommendedAlertSeverity.LeastSevere,
    });
    expect(missing.rules[0]!.alertSeverity?.id).toEqual(LOW_ID);
  });

  it("an SLO with no rules is missing all three, the pages at the most severe severity", async () => {
    storedRules = [];

    const missing: SloMissingRecommendedRules =
      await ServiceLevelObjectiveBurnRateRuleService.getMissingRecommendedRules(
        {
          serviceLevelObjectiveId: SLO_ID,
          props: caller(),
        },
      );

    expect(namesOf(missing.rules)).toEqual([
      SLO_FAST_BURN_RULE_NAME,
      SLO_SLOW_BURN_RULE_NAME,
      SLO_SLOW_LEAK_RULE_NAME,
    ]);
    expect(
      missing.rules.map((rule: { alertSeverity: AlertSeverity | null }) => {
        return rule.alertSeverity?.name;
      }),
    ).toEqual(["Critical", "Critical", "Low"]);
  });

  it("scales what is missing to the SLO's own window", async () => {
    storedSlo = sloWith({ windowType: SloWindowType.Rolling, windowDays: 28 });

    const missing: SloMissingRecommendedRules =
      await ServiceLevelObjectiveBurnRateRuleService.getMissingRecommendedRules(
        {
          serviceLevelObjectiveId: SLO_ID,
          props: caller(),
        },
      );

    expect(missing.rules[0]!.recommended).toMatchObject({
      name: "Slow leak",
      burnRateThreshold: 1,
      longWindowInMinutes: 4032,
      shortWindowInMinutes: 336,
    });

    storedSlo = sloWith({ windowType: SloWindowType.CalendarMonth });
    storedRules = [];

    expect(
      (
        await ServiceLevelObjectiveBurnRateRuleService.getMissingRecommendedRules(
          { serviceLevelObjectiveId: SLO_ID, props: caller() },
        )
      ).rules.map((rule: { recommended: SloRecommendedBurnRateRule }) => {
        return rule.recommended.burnRateThreshold;
      }),
    ).toEqual([14.4, 6, 1]);
  });

  it("a renamed or tuned default rule is not offered a second time", async () => {
    storedRules = [
      existingRule("Paging: fast burn", 60),
      existingRule("Slow burn", 240),
      existingRule("Ticket", 4320),
    ];

    const missing: SloMissingRecommendedRules =
      await ServiceLevelObjectiveBurnRateRuleService.getMissingRecommendedRules(
        {
          serviceLevelObjectiveId: SLO_ID,
          props: caller(),
        },
      );

    expect(missing.rules).toEqual([]);
  });

  it("asks for no severities when nothing is missing", async () => {
    storedRules.push(existingRule("Slow leak", 4320));

    await ServiceLevelObjectiveBurnRateRuleService.getMissingRecommendedRules({
      serviceLevelObjectiveId: SLO_ID,
      props: caller(),
    });

    expect(severityReadSpy).not.toHaveBeenCalled();
  });

  it("an SLO the caller may not read, or of another project, is not found", async () => {
    storedSlo = null;

    await expect(
      ServiceLevelObjectiveBurnRateRuleService.getMissingRecommendedRules({
        serviceLevelObjectiveId: SLO_ID,
        props: caller(),
      }),
    ).rejects.toThrow(new NotFoundException(SLO_NOT_FOUND_MESSAGE));

    // Nothing about the SLO's rules is read for it.
    expect(ruleReadSpy).not.toHaveBeenCalled();
  });

  it("a request in no project is refused before anything is read", async () => {
    await expect(
      ServiceLevelObjectiveBurnRateRuleService.getMissingRecommendedRules({
        serviceLevelObjectiveId: SLO_ID,
        props: { ...caller(), tenantId: undefined },
      }),
    ).rejects.toBeInstanceOf(BadDataException);

    expect(sloReadSpy).not.toHaveBeenCalled();
  });

  it("a failed severity read is not taken for a project with no severities", async () => {
    severityReadSpy.mockRejectedValue(new Error("severities down"));

    await expect(
      ServiceLevelObjectiveBurnRateRuleService.getMissingRecommendedRules({
        serviceLevelObjectiveId: SLO_ID,
        props: caller(),
      }),
    ).rejects.toThrow("severities down");
  });
});

describe("adding the missing recommended rules", () => {
  it("creates each missing rule as the caller, the way a rule made by hand is created", async () => {
    const props: DatabaseCommonInteractionProps = caller();

    const added: SloAddedRecommendedRules =
      await ServiceLevelObjectiveBurnRateRuleService.addMissingRecommendedRules(
        {
          serviceLevelObjectiveId: SLO_ID,
          props: props,
        },
      );

    expect(createSpy).toHaveBeenCalledTimes(1);

    const createBy: CreateBy<ServiceLevelObjectiveBurnRateRule> = createSpy
      .mock.calls[0]![0] as CreateBy<ServiceLevelObjectiveBurnRateRule>;

    // The caller's own props: their permissions, their name on the feed item and the audit log.
    expect(createBy.props).toBe(props);
    expect(createBy.props.isRoot).toBeUndefined();

    expect(createBy.data.name).toBe("Slow leak");
    expect(createBy.data.projectId).toEqual(PROJECT_ID);
    expect(createBy.data.serviceLevelObjectiveId).toEqual(SLO_ID);
    expect(createBy.data.isEnabled).toBe(true);
    expect(createBy.data.burnRateThreshold).toBe(1);
    expect(createBy.data.longWindowInMinutes).toBe(4320);
    expect(createBy.data.shortWindowInMinutes).toBe(360);
    expect(createBy.data.refireSuppressionMinutes).toBe(1440);
    expect(createBy.data.alertSeverityId).toEqual(LOW_ID);
    expect(createBy.data.shouldCreateIncident).toBeUndefined();

    expect(added.serviceLevelObjectiveId).toEqual(SLO_ID);
    expect(namesOf(added.rules)).toEqual(["Slow leak"]);
    expect(added.rules[0]!.ruleId?.toString()).toBe(
      createBy.data._id?.toString(),
    );
    expect(added.rules[0]!.alertSeverity?.name).toBe("Low");
  });

  /*
   * The seeding flag is what silences the feed for the rules a new SLO is
   * created with. Rules a person adds later must post their own items.
   */
  it("creates them outside the seeding flag, so each posts its own feed item", async () => {
    storedRules = [];

    await ServiceLevelObjectiveBurnRateRuleService.addMissingRecommendedRules({
      serviceLevelObjectiveId: SLO_ID,
      props: caller(),
    });

    expect(seedingFlagsAtCreate).toEqual([false, false, false]);
  });

  it("adds every missing rule, fastest first, each at its own severity", async () => {
    storedRules = [];

    await ServiceLevelObjectiveBurnRateRuleService.addMissingRecommendedRules({
      serviceLevelObjectiveId: SLO_ID,
      props: caller(),
    });

    expect(
      createdRules().map((rule: ServiceLevelObjectiveBurnRateRule) => {
        return [
          rule.name,
          rule.burnRateThreshold,
          rule.longWindowInMinutes,
          rule.shortWindowInMinutes,
          rule.refireSuppressionMinutes,
          rule.alertSeverityId?.toString(),
        ];
      }),
    ).toEqual([
      ["Fast burn", 14.4, 60, 5, undefined, CRITICAL_ID.toString()],
      ["Slow burn", 6, 360, 30, undefined, CRITICAL_ID.toString()],
      ["Slow leak", 1, 4320, 360, 1440, LOW_ID.toString()],
    ]);
  });

  it("adds nothing to an SLO that has every recommended rule", async () => {
    storedRules.push(existingRule("Slow leak", 4320));

    const added: SloAddedRecommendedRules =
      await ServiceLevelObjectiveBurnRateRuleService.addMissingRecommendedRules(
        {
          serviceLevelObjectiveId: SLO_ID,
          props: caller(),
        },
      );

    expect(added.rules).toEqual([]);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("is idempotent: asked again, it finds nothing left to add", async () => {
    storedRules = [];

    const first: SloAddedRecommendedRules =
      await ServiceLevelObjectiveBurnRateRuleService.addMissingRecommendedRules(
        { serviceLevelObjectiveId: SLO_ID, props: caller() },
      );
    const second: SloAddedRecommendedRules =
      await ServiceLevelObjectiveBurnRateRuleService.addMissingRecommendedRules(
        { serviceLevelObjectiveId: SLO_ID, props: caller() },
      );

    expect(first.rules).toHaveLength(3);
    expect(second.rules).toEqual([]);
    expect(createSpy).toHaveBeenCalledTimes(3);
  });

  /*
   * A double click, or the page open in two tabs: the second request waits
   * for the first one's lock, then works out what is missing afresh.
   */
  it("two requests at once add each rule once: the second waits for the first, then finds nothing to add", async () => {
    storedRules = [];

    const [first, second]: [
      SloAddedRecommendedRules,
      SloAddedRecommendedRules,
    ] = await Promise.all([
      ServiceLevelObjectiveBurnRateRuleService.addMissingRecommendedRules({
        serviceLevelObjectiveId: SLO_ID,
        props: caller(),
      }),
      ServiceLevelObjectiveBurnRateRuleService.addMissingRecommendedRules({
        serviceLevelObjectiveId: SLO_ID,
        props: caller(),
      }),
    ]);

    expect(createSpy).toHaveBeenCalledTimes(3);
    expect(first.rules.length + second.rules.length).toBe(3);
    expect([first.rules.length, second.rules.length].sort()).toEqual([0, 3]);

    const label: string = `${LOCK_NAMESPACE}/${SLO_ID.toString()}`;

    expect(locks.events).toEqual([
      `lock:${label}`,
      `wait:${label}`,
      `release:${label}`,
      `lock:${label}`,
      `release:${label}`,
    ]);
  });

  it("holds its lock per SLO, and gives it back", async () => {
    await ServiceLevelObjectiveBurnRateRuleService.addMissingRecommendedRules({
      serviceLevelObjectiveId: SLO_ID,
      props: caller(),
    });

    expect(locks.eventsOf("lock")).toEqual([
      `lock:${LOCK_NAMESPACE}/${SLO_ID.toString()}`,
    ]);
    expect(locks.isHeld(SLO_ID.toString(), LOCK_NAMESPACE)).toBe(false);
  });

  it("still adds the rules when the lock cannot be taken, and says so", async () => {
    locks.unreachable = true;

    const added: SloAddedRecommendedRules =
      await ServiceLevelObjectiveBurnRateRuleService.addMissingRecommendedRules(
        {
          serviceLevelObjectiveId: SLO_ID,
          props: caller(),
        },
      );

    expect(namesOf(added.rules)).toEqual(["Slow leak"]);
    expect(logger.error).toHaveBeenCalled();
    expect(locks.eventsOf("release")).toEqual([]);
  });

  it("a rule the create refuses stops the request, keeps what was added, and gives the lock back", async () => {
    storedRules = [];

    createSpy.mockImplementation((async (
      createBy: CreateBy<ServiceLevelObjectiveBurnRateRule>,
    ): Promise<ServiceLevelObjectiveBurnRateRule> => {
      if (createBy.data.name === "Slow burn") {
        throw new BadDataException("You do not have permission to do this.");
      }

      createBy.data._id = ObjectID.generate().toString();
      storedRules.push(createBy.data);

      return createBy.data;
    }) as never);

    await expect(
      ServiceLevelObjectiveBurnRateRuleService.addMissingRecommendedRules({
        serviceLevelObjectiveId: SLO_ID,
        props: caller(),
      }),
    ).rejects.toThrow("You do not have permission to do this.");

    // Fast burn stays; Slow leak was never attempted.
    expect(
      createSpy.mock.calls.map((call: Array<unknown>) => {
        return (call[0] as CreateBy<ServiceLevelObjectiveBurnRateRule>).data
          .name;
      }),
    ).toEqual(["Fast burn", "Slow burn"]);
    expect(locks.isHeld(SLO_ID.toString(), LOCK_NAMESPACE)).toBe(false);

    // Asked again, only what is still missing is added.
    createSpy.mockClear();
    createSpy.mockImplementation((async (
      createBy: CreateBy<ServiceLevelObjectiveBurnRateRule>,
    ): Promise<ServiceLevelObjectiveBurnRateRule> => {
      createBy.data._id = ObjectID.generate().toString();
      storedRules.push(createBy.data);
      return createBy.data;
    }) as never);

    await ServiceLevelObjectiveBurnRateRuleService.addMissingRecommendedRules({
      serviceLevelObjectiveId: SLO_ID,
      props: caller(),
    });

    expect(
      createdRules().map((rule: ServiceLevelObjectiveBurnRateRule) => {
        return rule.name;
      }),
    ).toEqual(["Slow burn", "Slow leak"]);
  });

  it("adds nothing for an SLO the caller may not read, and gives the lock back", async () => {
    storedSlo = null;

    await expect(
      ServiceLevelObjectiveBurnRateRuleService.addMissingRecommendedRules({
        serviceLevelObjectiveId: SLO_ID,
        props: caller(),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(createSpy).not.toHaveBeenCalled();
    expect(locks.isHeld(SLO_ID.toString(), LOCK_NAMESPACE)).toBe(false);
  });

  it("adds nothing when the severities cannot be read: a ticket rule never goes in without the severity that keeps it from paging", async () => {
    severityReadSpy.mockRejectedValue(new Error("severities down"));

    await expect(
      ServiceLevelObjectiveBurnRateRuleService.addMissingRecommendedRules({
        serviceLevelObjectiveId: SLO_ID,
        props: caller(),
      }),
    ).rejects.toThrow("severities down");

    expect(createSpy).not.toHaveBeenCalled();
  });
});
