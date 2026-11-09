import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import ServiceLevelObjectiveBurnRateRuleService, {
  SLO_NOT_FOUND_MESSAGE,
  SloAddedRecommendedRule,
  SloBulkAddedRecommendedRules,
  SloBulkMissingRecommendedRules,
  SloMissingRecommendedRule,
  SloMissingRecommendedRules,
  getSloBulkErrorMessage,
  getSloBulkIds,
  isSloBulkRefusal,
} from "../../../Server/Services/ServiceLevelObjectiveBurnRateRuleService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import FindAllBy from "../../../Server/Types/Database/FindAllBy";
import FindBy from "../../../Server/Types/Database/FindBy";
import FindOneBy from "../../../Server/Types/Database/FindOneBy";
import logger from "../../../Server/Utils/Logger";
import SloFeedUtil from "../../../Server/Utils/Slo/SloFeedUtil";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ForbiddenException from "../../../Types/Exception/ForbiddenException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ServerException from "../../../Types/Exception/ServerException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import UserType from "../../../Types/UserType";
import {
  SLO_FAST_BURN_RULE_NAME,
  SLO_SLOW_BURN_RULE_NAME,
  SLO_SLOW_LEAK_RULE_NAME,
  SloRecommendedBurnRateRule,
} from "../../../Utils/Slo/SloRecommendedBurnRateRules";
import {
  SLO_BULK_ADD_FAILED_MESSAGE,
  SLO_BULK_NO_IDS_MESSAGE,
  SLO_BULK_TOO_MANY_MESSAGE,
  SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS,
  SloBulkRecommendedRulesStatus,
} from "../../../Utils/Slo/SloBulkRecommendedBurnRateRules";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";
import InMemoryLocks from "../TestingUtils/InMemoryLocks";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * "Add recommended rules" for many SLOs at once (the SLO list's Bulk
 * Actions), on the server.
 *
 * What is pinned:
 *
 *   - asking what many SLOs are missing reads the SLOs AS THE CALLER, all in
 *     one read pinned to their project - an SLO they may not read, or of
 *     another project, is Refused as not found and nothing of it is read -
 *     then every rule of the SLOs found, as root, and the project's
 *     severities once; it answers each SLO exactly as the one-SLO question
 *     would, scaled to its own window, and writes nothing;
 *   - adding to many SLOs takes each through the one-SLO add, one after
 *     another: its own lock, what is missing worked out again inside it,
 *     each rule created as the caller (the feed item and the audit log come
 *     with that create);
 *   - one SLO's refusal or failure is its own: it is reported - Refused for
 *     an SLO the caller may not read or change, Failed with the rules added
 *     before it for anything else - and the SLOs after it are added to;
 *   - it is idempotent: a second run adds nothing, and two runs at once
 *     over the same SLOs add each rule once;
 *   - a request names between one and SLO_RECOMMENDED_BURN_RATE_RULES_BULK
 *     _MAX_SLOS SLOs, each once, and is answered in the order it named them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const CRITICAL_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const LOW_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");

const SLO_A: ObjectID = new ObjectID("a1111111-1111-4111-8111-111111111111");
const SLO_B: ObjectID = new ObjectID("b2222222-2222-4222-8222-222222222222");
const SLO_C: ObjectID = new ObjectID("c3333333-3333-4333-8333-333333333333");
const SLO_D: ObjectID = new ObjectID("d4444444-4444-4444-8444-444444444444");

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

function sloOf(
  id: ObjectID,
  window: { windowType?: SloWindowType; windowDays?: number },
): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo._id = id.toString();
  slo.id = id;
  slo.projectId = PROJECT_ID;

  if (window.windowType) {
    slo.windowType = window.windowType;
  }

  if (window.windowDays !== undefined) {
    slo.windowDays = window.windowDays;
  }

  return slo;
}

function ruleOf(
  sloId: ObjectID,
  name: string,
  longWindowInMinutes: number,
): ServiceLevelObjectiveBurnRateRule {
  const rule: ServiceLevelObjectiveBurnRateRule =
    new ServiceLevelObjectiveBurnRateRule();
  rule._id = ObjectID.generate().toString();
  rule.serviceLevelObjectiveId = sloId;
  rule.name = name;
  rule.longWindowInMinutes = longWindowInMinutes;
  return rule;
}

// The rules an SLO created before Slow leak existed was given.
function upgradedRules(
  sloId: ObjectID,
): Array<ServiceLevelObjectiveBurnRateRule> {
  return [ruleOf(sloId, "Fast burn", 60), ruleOf(sloId, "Slow burn", 360)];
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

/*
 * The project as Postgres would hold it: the SLOs the caller may read (one
 * left out of `readable` is one they may not), and every rule.
 */
let readable: Map<string, ServiceLevelObjective>;
let storedRules: Array<ServiceLevelObjectiveBurnRateRule>;
let createFailure:
  | ((rule: ServiceLevelObjectiveBurnRateRule) => Error | null)
  | null;
let seedingFlagsAtCreate: Array<boolean>;
let locks: InMemoryLocks;

let bulkSloReadSpy: jest.SpyInstance;
let oneSloReadSpy: jest.SpyInstance;
let bulkRuleReadSpy: jest.SpyInstance;
let oneRuleReadSpy: jest.SpyInstance;
let severityReadSpy: jest.SpyInstance;
let createSpy: jest.SpyInstance;
let loggerErrorSpy: jest.SpyInstance;

function store(...slos: Array<ServiceLevelObjective>): void {
  for (const slo of slos) {
    readable.set(keyOf(slo.id), slo);
  }
}

beforeEach(() => {
  readable = new Map();
  storedRules = [];
  createFailure = null;
  seedingFlagsAtCreate = [];

  loggerErrorSpy = jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });

  // The bulk question's one read of the SLOs, as the caller.
  bulkSloReadSpy = jest
    .spyOn(ServiceLevelObjectiveService, "findBy")
    .mockImplementation((async (
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
  oneSloReadSpy = jest
    .spyOn(ServiceLevelObjectiveService, "findOneBy")
    .mockImplementation((async (
      findOneBy: FindOneBy<ServiceLevelObjective>,
    ): Promise<ServiceLevelObjective | null> => {
      return (
        readable.get(
          keyOf((findOneBy.query as Record<string, unknown>)["_id"]),
        ) || null
      );
    }) as never);

  // The bulk question's read of every rule of the SLOs it found, as root.
  bulkRuleReadSpy = jest
    .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findAllBy")
    .mockImplementation((async (
      findAllBy: FindAllBy<ServiceLevelObjectiveBurnRateRule>,
    ): Promise<Array<ServiceLevelObjectiveBurnRateRule>> => {
      const asked: Array<string> = idsIn(
        (findAllBy.query as Record<string, unknown>)["serviceLevelObjectiveId"],
      );

      return storedRules.filter(
        (rule: ServiceLevelObjectiveBurnRateRule): boolean => {
          return asked.includes(keyOf(rule.serviceLevelObjectiveId));
        },
      );
    }) as never);

  // The one-SLO add's read of its SLO's rules, as root.
  oneRuleReadSpy = jest
    .spyOn(ServiceLevelObjectiveBurnRateRuleService, "findBy")
    .mockImplementation((async (
      findBy: FindBy<ServiceLevelObjectiveBurnRateRule>,
    ): Promise<Array<ServiceLevelObjectiveBurnRateRule>> => {
      const sloId: string = keyOf(
        (findBy.query as Record<string, unknown>)["serviceLevelObjectiveId"],
      );

      return storedRules.filter(
        (rule: ServiceLevelObjectiveBurnRateRule): boolean => {
          return keyOf(rule.serviceLevelObjectiveId) === sloId;
        },
      );
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

      const failure: Error | null = createFailure
        ? createFailure(createBy.data)
        : null;

      if (failure) {
        throw failure;
      }

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

function namesOf(
  rules: Array<{ recommended: SloRecommendedBurnRateRule }>,
): Array<string> {
  return rules.map(
    (rule: { recommended: SloRecommendedBurnRateRule }): string => {
      return rule.recommended.name;
    },
  );
}

function createdFor(sloId: ObjectID): Array<string> {
  return createSpy.mock.calls
    .map((call: Array<unknown>) => {
      return (call[0] as CreateBy<ServiceLevelObjectiveBurnRateRule>).data;
    })
    .filter((rule: ServiceLevelObjectiveBurnRateRule): boolean => {
      return keyOf(rule.serviceLevelObjectiveId) === keyOf(sloId);
    })
    .map((rule: ServiceLevelObjectiveBurnRateRule): string => {
      return rule.name || "";
    });
}

async function askMany(
  ids: Array<ObjectID>,
  props: DatabaseCommonInteractionProps = caller(),
): Promise<Array<SloBulkMissingRecommendedRules>> {
  return await ServiceLevelObjectiveBurnRateRuleService.getMissingRecommendedRulesForMany(
    { serviceLevelObjectiveIds: ids, props: props },
  );
}

async function addToMany(
  ids: Array<ObjectID>,
  props: DatabaseCommonInteractionProps = caller(),
): Promise<Array<SloBulkAddedRecommendedRules>> {
  return await ServiceLevelObjectiveBurnRateRuleService.addMissingRecommendedRulesToMany(
    { serviceLevelObjectiveIds: ids, props: props },
  );
}

function manyIds(count: number): Array<ObjectID> {
  const ids: Array<ObjectID> = [];

  for (let index: number = 0; index < count; index++) {
    ids.push(ObjectID.generate());
  }

  return ids;
}

describe("asking what many SLOs are missing", () => {
  beforeEach(() => {
    store(
      sloOf(SLO_A, { windowType: SloWindowType.Rolling, windowDays: 30 }),
      sloOf(SLO_B, { windowType: SloWindowType.Rolling, windowDays: 7 }),
      sloOf(SLO_C, { windowType: SloWindowType.CalendarMonth }),
    );

    storedRules = [
      ...upgradedRules(SLO_A),
      ...upgradedRules(SLO_C),
      ruleOf(SLO_C, "Slow leak", 4320),
    ];
  });

  it("reads the SLOs as the caller, all of them in one read pinned to the caller's project", async () => {
    const props: DatabaseCommonInteractionProps = caller();

    await askMany([SLO_A, SLO_B, SLO_C], props);

    expect(bulkSloReadSpy).toHaveBeenCalledTimes(1);

    const read: FindBy<ServiceLevelObjective> = bulkSloReadSpy.mock
      .calls[0]![0] as FindBy<ServiceLevelObjective>;
    const query: Record<string, unknown> = read.query as Record<
      string,
      unknown
    >;

    expect(idsIn(query["_id"])).toEqual([
      keyOf(SLO_A),
      keyOf(SLO_B),
      keyOf(SLO_C),
    ]);
    expect(query["projectId"]).toEqual(PROJECT_ID);
    expect(read.select).toEqual({
      _id: true,
      projectId: true,
      windowType: true,
      windowDays: true,
    });
    expect(read.skip).toBe(0);
    expect(read.limit).toBe(3);
    // The caller's own props, never root.
    expect(read.props).toBe(props);

    // Not the one-SLO reads, once per SLO.
    expect(oneSloReadSpy).not.toHaveBeenCalled();
    expect(oneRuleReadSpy).not.toHaveBeenCalled();
  });

  it("reads every rule of the SLOs it found, as root, pinned to them and their project, however many there are", async () => {
    await askMany([SLO_A, SLO_B, SLO_C]);

    expect(bulkRuleReadSpy).toHaveBeenCalledTimes(1);

    const read: FindAllBy<ServiceLevelObjectiveBurnRateRule> = bulkRuleReadSpy
      .mock.calls[0]![0] as FindAllBy<ServiceLevelObjectiveBurnRateRule>;
    const query: Record<string, unknown> = read.query as Record<
      string,
      unknown
    >;

    expect(idsIn(query["serviceLevelObjectiveId"])).toEqual([
      keyOf(SLO_A),
      keyOf(SLO_B),
      keyOf(SLO_C),
    ]);
    expect(query["projectId"]).toEqual(PROJECT_ID);
    expect(read.select).toEqual({
      _id: true,
      serviceLevelObjectiveId: true,
      name: true,
      longWindowInMinutes: true,
    });
    expect(read.props).toEqual({ isRoot: true });
    // Every page of them: a rule cut off by a limit would read as missing.
    expect(read.limit).toBeUndefined();
  });

  it("says what each SLO is missing, scaled to its own window", async () => {
    const answers: Array<SloBulkMissingRecommendedRules> = await askMany([
      SLO_A,
      SLO_B,
      SLO_C,
    ]);

    expect(
      answers.map((answer: SloBulkMissingRecommendedRules): Array<unknown> => {
        return [
          answer.serviceLevelObjectiveId.toString(),
          answer.status,
          answer.rules.map(
            (rule: SloMissingRecommendedRule): Array<unknown> => {
              return [
                rule.recommended.name,
                rule.recommended.burnRateThreshold,
                rule.recommended.longWindowInMinutes,
                rule.recommended.shortWindowInMinutes,
                rule.alertSeverity?.name,
              ];
            },
          ),
          answer.message,
        ];
      }),
    ).toEqual([
      // 30 days, from before Slow leak existed: just Slow leak.
      [
        SLO_A.toString(),
        SloBulkRecommendedRulesStatus.Missing,
        [["Slow leak", 1, 4320, 360, "Low"]],
        null,
      ],
      // 7 days, every rule deleted: all three, scaled to 7 days.
      [
        SLO_B.toString(),
        SloBulkRecommendedRulesStatus.Missing,
        [
          ["Fast burn", 3.36, 60, 5, "Critical"],
          ["Slow burn", 1.4, 360, 30, "Critical"],
          ["Slow leak", 1, 1008, 84, "Low"],
        ],
        null,
      ],
      // A calendar month with all three: nothing.
      [
        SLO_C.toString(),
        SloBulkRecommendedRulesStatus.NothingMissing,
        [],
        null,
      ],
    ]);
  });

  it("reads the project's severities once for the whole request", async () => {
    await askMany([SLO_A, SLO_B]);

    expect(severityReadSpy).toHaveBeenCalledTimes(1);
  });

  it("asks for no severities when no SLO is missing anything", async () => {
    storedRules.push(ruleOf(SLO_A, "Slow leak", 4320));

    const answers: Array<SloBulkMissingRecommendedRules> = await askMany([
      SLO_A,
      SLO_C,
    ]);

    expect(severityReadSpy).not.toHaveBeenCalled();
    expect(
      answers.map((answer: SloBulkMissingRecommendedRules): string => {
        return answer.status;
      }),
    ).toEqual([
      SloBulkRecommendedRulesStatus.NothingMissing,
      SloBulkRecommendedRulesStatus.NothingMissing,
    ]);
  });

  it("an SLO the caller may not read, or of another project, is refused as not found, and nothing of it is read", async () => {
    readable.delete(keyOf(SLO_B));

    const answers: Array<SloBulkMissingRecommendedRules> = await askMany([
      SLO_A,
      SLO_B,
    ]);

    expect(answers[1]).toEqual({
      serviceLevelObjectiveId: SLO_B,
      status: SloBulkRecommendedRulesStatus.Refused,
      rules: [],
      message: SLO_NOT_FOUND_MESSAGE,
    });

    // Its rules are not asked about: the read names the SLOs found only.
    expect(
      idsIn(
        (
          (
            bulkRuleReadSpy.mock
              .calls[0]![0] as FindAllBy<ServiceLevelObjectiveBurnRateRule>
          ).query as Record<string, unknown>
        )["serviceLevelObjectiveId"],
      ),
    ).toEqual([keyOf(SLO_A)]);
  });

  it("reads no rules and no severities when it can read none of the SLOs", async () => {
    readable.clear();

    const answers: Array<SloBulkMissingRecommendedRules> = await askMany([
      SLO_A,
      SLO_B,
    ]);

    expect(
      answers.map((answer: SloBulkMissingRecommendedRules): string => {
        return answer.status;
      }),
    ).toEqual([
      SloBulkRecommendedRulesStatus.Refused,
      SloBulkRecommendedRulesStatus.Refused,
    ]);
    expect(bulkRuleReadSpy).not.toHaveBeenCalled();
    expect(severityReadSpy).not.toHaveBeenCalled();
  });

  it("answers in the order it was asked, each SLO once, whatever the case of its id", async () => {
    const answers: Array<SloBulkMissingRecommendedRules> = await askMany([
      SLO_C,
      SLO_A,
      new ObjectID(SLO_A.toString().toUpperCase()),
      SLO_B,
      SLO_C,
    ]);

    expect(
      answers.map((answer: SloBulkMissingRecommendedRules): string => {
        return keyOf(answer.serviceLevelObjectiveId);
      }),
    ).toEqual([keyOf(SLO_C), keyOf(SLO_A), keyOf(SLO_B)]);
  });

  it("writes nothing and takes no lock", async () => {
    await askMany([SLO_A, SLO_B, SLO_C]);

    expect(createSpy).not.toHaveBeenCalled();
    expect(locks.events).toEqual([]);
  });

  it("a failed severity read reaches the caller: a ticket rule is never offered without the severity that keeps it from paging", async () => {
    severityReadSpy.mockRejectedValue(new Error("severities down"));

    await expect(askMany([SLO_A])).rejects.toThrow("severities down");
  });

  it("is refused before anything is read outside a project", async () => {
    await expect(
      askMany([SLO_A], { ...caller(), tenantId: undefined }),
    ).rejects.toBeInstanceOf(BadDataException);

    expect(bulkSloReadSpy).not.toHaveBeenCalled();
  });

  it("is refused before anything is read for no SLOs, or for more than one request may name", async () => {
    await expect(askMany([])).rejects.toThrow(
      new BadDataException(SLO_BULK_NO_IDS_MESSAGE),
    );
    await expect(
      askMany(manyIds(SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS + 1)),
    ).rejects.toThrow(new BadDataException(SLO_BULK_TOO_MANY_MESSAGE));

    expect(bulkSloReadSpy).not.toHaveBeenCalled();

    // As many as it may name is fine.
    const answers: Array<SloBulkMissingRecommendedRules> = await askMany(
      manyIds(SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS),
    );

    expect(answers).toHaveLength(SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS);
  });

  /*
   * One question for many SLOs must never answer an SLO differently from
   * the question its own Burn Rate Rules page asks: drawn windows and rule
   * sets - renamed, tuned, moved, disabled-by-name - each SLO's answer from
   * both, compared.
   */
  it("gives each SLO the answer its own Burn Rate Rules page gets", async () => {
    const random: SeededRandom = seededRandom(6310);
    const windows: Array<{ windowType?: SloWindowType; windowDays?: number }> =
      [
        { windowType: SloWindowType.Rolling, windowDays: 1 },
        { windowType: SloWindowType.Rolling, windowDays: 7 },
        { windowType: SloWindowType.Rolling, windowDays: 14 },
        { windowType: SloWindowType.Rolling, windowDays: 28 },
        { windowType: SloWindowType.Rolling, windowDays: 30 },
        { windowType: SloWindowType.Rolling, windowDays: 90 },
        { windowType: SloWindowType.Rolling, windowDays: 366 },
        { windowType: SloWindowType.CalendarMonth },
        {},
      ];
    const names: Array<string> = [
      SLO_FAST_BURN_RULE_NAME,
      SLO_SLOW_BURN_RULE_NAME,
      SLO_SLOW_LEAK_RULE_NAME,
      "  fast BURN ",
      "Paging",
      "Ticket",
    ];
    const longWindows: Array<number> = [5, 30, 60, 240, 360, 1008, 4032, 4320];

    readable.clear();
    storedRules = [];

    const ids: Array<ObjectID> = manyIds(60);

    for (const id of ids) {
      store(sloOf(id, windows[random(windows.length)]!));

      const ruleCount: number = random(4);

      for (let index: number = 0; index < ruleCount; index++) {
        storedRules.push(
          ruleOf(
            id,
            names[random(names.length)]!,
            longWindows[random(longWindows.length)]!,
          ),
        );
      }
    }

    // And SLOs whose own rules cover every recommended one, renamed or tuned.
    const complete: Array<ObjectID> = manyIds(3);

    for (const id of complete) {
      store(sloOf(id, { windowType: SloWindowType.Rolling, windowDays: 30 }));
      storedRules.push(
        ruleOf(id, "  fast BURN ", 30),
        ruleOf(id, "Paging", 360),
        ruleOf(id, "Ticket", 4320),
      );
    }

    const bulk: Array<SloBulkMissingRecommendedRules> = await askMany(
      shuffled([...ids, ...complete], random),
    );

    let missingCount: number = 0;

    for (const answer of bulk) {
      const single: SloMissingRecommendedRules =
        await ServiceLevelObjectiveBurnRateRuleService.getMissingRecommendedRules(
          {
            serviceLevelObjectiveId: answer.serviceLevelObjectiveId,
            props: caller(),
          },
        );

      const shape: (
        rules: Array<SloMissingRecommendedRule>,
      ) => Array<unknown> = (
        rules: Array<SloMissingRecommendedRule>,
      ): Array<unknown> => {
        return rules.map((rule: SloMissingRecommendedRule) => {
          return [rule.recommended, rule.alertSeverity?.id?.toString()];
        });
      };

      expect({
        slo: answer.serviceLevelObjectiveId.toString(),
        rules: shape(answer.rules),
      }).toEqual({
        slo: answer.serviceLevelObjectiveId.toString(),
        rules: shape(single.rules),
      });
      expect(answer.status).toBe(
        single.rules.length > 0
          ? SloBulkRecommendedRulesStatus.Missing
          : SloBulkRecommendedRulesStatus.NothingMissing,
      );

      missingCount += single.rules.length > 0 ? 1 : 0;
    }

    // Not vacuous: SLOs of both kinds were compared.
    expect(bulk).toHaveLength(63);
    expect(missingCount).toBeGreaterThan(30);
    expect(bulk.length - missingCount).toBeGreaterThanOrEqual(3);
  });
});

describe("adding to many SLOs at once", () => {
  beforeEach(() => {
    store(
      sloOf(SLO_A, { windowType: SloWindowType.Rolling, windowDays: 30 }),
      sloOf(SLO_B, { windowType: SloWindowType.Rolling, windowDays: 7 }),
      sloOf(SLO_C, { windowType: SloWindowType.CalendarMonth }),
      sloOf(SLO_D, { windowType: SloWindowType.Rolling, windowDays: 28 }),
    );

    storedRules = [
      ...upgradedRules(SLO_A),
      ...upgradedRules(SLO_C),
      ruleOf(SLO_C, "Slow leak", 4320),
      ...upgradedRules(SLO_D),
    ];
  });

  it("takes each SLO through the one-SLO add, with the caller's own props", async () => {
    const props: DatabaseCommonInteractionProps = caller();
    const oneSpy: jest.SpyInstance = jest.spyOn(
      ServiceLevelObjectiveBurnRateRuleService,
      "addMissingRecommendedRules",
    );

    await addToMany([SLO_A, SLO_B], props);

    expect(oneSpy).toHaveBeenCalledTimes(2);
    expect(
      oneSpy.mock.calls.map((call: Array<unknown>): Array<unknown> => {
        const data: {
          serviceLevelObjectiveId: ObjectID;
          props: DatabaseCommonInteractionProps;
        } = call[0] as {
          serviceLevelObjectiveId: ObjectID;
          props: DatabaseCommonInteractionProps;
        };

        return [data.serviceLevelObjectiveId.toString(), data.props === props];
      }),
    ).toEqual([
      [SLO_A.toString(), true],
      [SLO_B.toString(), true],
    ]);

    // Every create as the caller: their permissions, their name on the feed item and the audit log.
    for (const call of createSpy.mock.calls) {
      const createBy: CreateBy<ServiceLevelObjectiveBurnRateRule> =
        call[0] as CreateBy<ServiceLevelObjectiveBurnRateRule>;

      expect(createBy.props).toBe(props);
      expect(createBy.props.isRoot).toBeUndefined();
    }
  });

  it("adds only what each SLO is missing, scaled to its own window, and says what it added", async () => {
    const results: Array<SloBulkAddedRecommendedRules> = await addToMany([
      SLO_A,
      SLO_B,
      SLO_C,
      SLO_D,
    ]);

    expect(
      results.map((result: SloBulkAddedRecommendedRules): Array<unknown> => {
        return [
          result.serviceLevelObjectiveId.toString(),
          result.status,
          namesOf(result.rules),
          result.message,
        ];
      }),
    ).toEqual([
      [
        SLO_A.toString(),
        SloBulkRecommendedRulesStatus.Added,
        ["Slow leak"],
        null,
      ],
      [
        SLO_B.toString(),
        SloBulkRecommendedRulesStatus.Added,
        ["Fast burn", "Slow burn", "Slow leak"],
        null,
      ],
      [
        SLO_C.toString(),
        SloBulkRecommendedRulesStatus.NothingMissing,
        [],
        null,
      ],
      [
        SLO_D.toString(),
        SloBulkRecommendedRulesStatus.Added,
        ["Slow leak"],
        null,
      ],
    ]);

    // Each added rule carries the id it was created with.
    for (const result of results) {
      for (const rule of result.rules) {
        expect(rule.ruleId).toBeInstanceOf(ObjectID);
      }
    }

    expect(createdFor(SLO_C)).toEqual([]);

    // Slow leak on 28 days: a tenth of the window, at 1x.
    const leakOfD: ServiceLevelObjectiveBurnRateRule | undefined =
      storedRules.find((rule: ServiceLevelObjectiveBurnRateRule): boolean => {
        return (
          keyOf(rule.serviceLevelObjectiveId) === keyOf(SLO_D) &&
          rule.name === "Slow leak"
        );
      });

    expect(leakOfD?.longWindowInMinutes).toBe(4032);
    expect(leakOfD?.shortWindowInMinutes).toBe(336);
    expect(leakOfD?.burnRateThreshold).toBe(1);
    expect(leakOfD?.alertSeverityId).toEqual(LOW_ID);
  });

  it("goes one SLO after another, each under its own lock, and gives every lock back", async () => {
    await addToMany([SLO_A, SLO_B, SLO_C]);

    expect(locks.events).toEqual([
      `lock:${LOCK_NAMESPACE}/${SLO_A.toString()}`,
      `release:${LOCK_NAMESPACE}/${SLO_A.toString()}`,
      `lock:${LOCK_NAMESPACE}/${SLO_B.toString()}`,
      `release:${LOCK_NAMESPACE}/${SLO_B.toString()}`,
      `lock:${LOCK_NAMESPACE}/${SLO_C.toString()}`,
      `release:${LOCK_NAMESPACE}/${SLO_C.toString()}`,
    ]);

    for (const id of [SLO_A, SLO_B, SLO_C]) {
      expect(locks.isHeld(id.toString(), LOCK_NAMESPACE)).toBe(false);
    }
  });

  it("creates every rule outside the seeding flag, so each posts its own feed item", async () => {
    await addToMany([SLO_A, SLO_B]);

    expect(seedingFlagsAtCreate).toEqual([false, false, false, false]);
  });

  it("an SLO the caller may not read is Refused as not found, and the SLOs after it are still added to", async () => {
    readable.delete(keyOf(SLO_B));

    const results: Array<SloBulkAddedRecommendedRules> = await addToMany([
      SLO_A,
      SLO_B,
      SLO_D,
    ]);

    expect(results[1]).toEqual({
      serviceLevelObjectiveId: SLO_B,
      status: SloBulkRecommendedRulesStatus.Refused,
      rules: [],
      message: SLO_NOT_FOUND_MESSAGE,
    });
    expect(results[2]!.status).toBe(SloBulkRecommendedRulesStatus.Added);
    expect(createdFor(SLO_B)).toEqual([]);
    expect(createdFor(SLO_D)).toEqual(["Slow leak"]);

    // A refusal is the caller's, not a fault: nothing is logged as one.
    expect(loggerErrorSpy).not.toHaveBeenCalledWith(
      expect.stringContaining(
        `Could not add the recommended burn rate rules to SLO ${SLO_B.toString()}`,
      ),
      expect.anything(),
    );
  });

  it("an SLO whose rules the caller may not create is Refused in the server's words, and adds nothing", async () => {
    createFailure = (rule: ServiceLevelObjectiveBurnRateRule): Error | null => {
      return keyOf(rule.serviceLevelObjectiveId) === keyOf(SLO_A)
        ? new NotAuthorizedException(
            "You do not have permission to create SLO Burn Rate Rule.",
          )
        : null;
    };

    const results: Array<SloBulkAddedRecommendedRules> = await addToMany([
      SLO_A,
      SLO_D,
    ]);

    expect(results[0]).toEqual({
      serviceLevelObjectiveId: SLO_A,
      status: SloBulkRecommendedRulesStatus.Refused,
      rules: [],
      message: "You do not have permission to create SLO Burn Rate Rule.",
    });
    expect(results[1]!.status).toBe(SloBulkRecommendedRulesStatus.Added);
    expect(locks.isHeld(SLO_A.toString(), LOCK_NAMESPACE)).toBe(false);
  });

  it("an SLO that fails part of the way is Failed, says what it added before it failed, and stops nothing after it", async () => {
    // SLO_B is missing all three; its second create breaks.
    createFailure = (rule: ServiceLevelObjectiveBurnRateRule): Error | null => {
      return keyOf(rule.serviceLevelObjectiveId) === keyOf(SLO_B) &&
        rule.name === "Slow burn"
        ? new BadDataException("Long window must be longer than short window.")
        : null;
    };

    const results: Array<SloBulkAddedRecommendedRules> = await addToMany([
      SLO_B,
      SLO_D,
    ]);

    expect(results[0]!.status).toBe(SloBulkRecommendedRulesStatus.Failed);
    expect(results[0]!.message).toBe(
      "Long window must be longer than short window.",
    );
    // Fast burn went in before Slow burn failed; Slow leak was never tried.
    expect(namesOf(results[0]!.rules)).toEqual(["Fast burn"]);
    expect(results[0]!.rules[0]!.ruleId).toBeInstanceOf(ObjectID);
    expect(createdFor(SLO_B)).toEqual(["Fast burn", "Slow burn"]);

    expect(results[1]!.status).toBe(SloBulkRecommendedRulesStatus.Added);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        `Could not add the recommended burn rate rules to SLO ${SLO_B.toString()}`,
      ),
      expect.anything(),
    );

    // Asked again, only what is still missing is added.
    createFailure = null;
    createSpy.mockClear();

    const retried: Array<SloBulkAddedRecommendedRules> = await addToMany([
      SLO_B,
      SLO_D,
    ]);

    expect(namesOf(retried[0]!.rules)).toEqual(["Slow burn", "Slow leak"]);
    expect(retried[1]!.status).toBe(
      SloBulkRecommendedRulesStatus.NothingMissing,
    );
  });

  it("a failure that is not OneUptime's own sentence is said in the generic one, and logged", async () => {
    createFailure = (): Error => {
      return new Error("socket hang up");
    };

    const results: Array<SloBulkAddedRecommendedRules> = await addToMany([
      SLO_A,
    ]);

    expect(results).toEqual([
      {
        serviceLevelObjectiveId: SLO_A,
        status: SloBulkRecommendedRulesStatus.Failed,
        rules: [],
        message: SLO_BULK_ADD_FAILED_MESSAGE,
      },
    ]);
    expect(loggerErrorSpy).toHaveBeenCalled();
  });

  it("a failed severity read fails each SLO it reaches, and adds nothing to any", async () => {
    severityReadSpy.mockRejectedValue(new ServerException("severities down"));

    const results: Array<SloBulkAddedRecommendedRules> = await addToMany([
      SLO_A,
      SLO_D,
    ]);

    expect(
      results.map((result: SloBulkAddedRecommendedRules): Array<unknown> => {
        return [result.status, result.message];
      }),
    ).toEqual([
      [SloBulkRecommendedRulesStatus.Failed, "severities down"],
      [SloBulkRecommendedRulesStatus.Failed, "severities down"],
    ]);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("is idempotent: run again over the same SLOs, it adds nothing", async () => {
    const first: Array<SloBulkAddedRecommendedRules> = await addToMany([
      SLO_A,
      SLO_B,
      SLO_D,
    ]);
    const createsAfterFirst: number = createSpy.mock.calls.length;

    const second: Array<SloBulkAddedRecommendedRules> = await addToMany([
      SLO_A,
      SLO_B,
      SLO_D,
    ]);

    expect(createsAfterFirst).toBe(5);
    expect(
      first.map((result: SloBulkAddedRecommendedRules): string => {
        return result.status;
      }),
    ).toEqual([
      SloBulkRecommendedRulesStatus.Added,
      SloBulkRecommendedRulesStatus.Added,
      SloBulkRecommendedRulesStatus.Added,
    ]);
    expect(
      second.map((result: SloBulkAddedRecommendedRules): string => {
        return result.status;
      }),
    ).toEqual([
      SloBulkRecommendedRulesStatus.NothingMissing,
      SloBulkRecommendedRulesStatus.NothingMissing,
      SloBulkRecommendedRulesStatus.NothingMissing,
    ]);
    expect(createSpy.mock.calls.length).toBe(createsAfterFirst);
  });

  /*
   * A double click, a second tab, a retry over the same selection: each
   * SLO's lock serialises the two, and the second finds nothing left.
   */
  it("two runs at once over the same SLOs add each rule once", async () => {
    const [first, second]: [
      Array<SloBulkAddedRecommendedRules>,
      Array<SloBulkAddedRecommendedRules>,
    ] = await Promise.all([
      addToMany([SLO_A, SLO_B]),
      addToMany([SLO_A, SLO_B]),
    ]);

    expect(createdFor(SLO_A)).toEqual(["Slow leak"]);
    expect(createdFor(SLO_B)).toEqual(["Fast burn", "Slow burn", "Slow leak"]);

    for (const index of [0, 1]) {
      const added: number = first[index]!.rules.length;
      const addedAgain: number = second[index]!.rules.length;

      expect(added + addedAgain).toBe(index === 0 ? 1 : 3);
      expect(Math.min(added, addedAgain)).toBe(0);
    }

    expect(locks.eventsOf("wait").length).toBeGreaterThan(0);
  });

  it("still adds when the locks cannot be taken, and says so", async () => {
    locks.unreachable = true;

    const results: Array<SloBulkAddedRecommendedRules> = await addToMany([
      SLO_A,
    ]);

    expect(results[0]!.status).toBe(SloBulkRecommendedRulesStatus.Added);
    expect(loggerErrorSpy).toHaveBeenCalled();
  });

  it("answers in the order it was asked, each SLO once", async () => {
    const results: Array<SloBulkAddedRecommendedRules> = await addToMany([
      SLO_D,
      SLO_A,
      new ObjectID(SLO_D.toString().toUpperCase()),
      SLO_A,
    ]);

    expect(
      results.map((result: SloBulkAddedRecommendedRules): string => {
        return keyOf(result.serviceLevelObjectiveId);
      }),
    ).toEqual([keyOf(SLO_D), keyOf(SLO_A)]);
    expect(createdFor(SLO_D)).toEqual(["Slow leak"]);
  });

  it("is refused before anything is read or locked outside a project, for no SLOs, or for more than one request may name", async () => {
    await expect(
      addToMany([SLO_A], { ...caller(), tenantId: undefined }),
    ).rejects.toBeInstanceOf(BadDataException);
    await expect(addToMany([])).rejects.toThrow(
      new BadDataException(SLO_BULK_NO_IDS_MESSAGE),
    );
    await expect(
      addToMany(manyIds(SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS + 1)),
    ).rejects.toThrow(new BadDataException(SLO_BULK_TOO_MANY_MESSAGE));

    expect(oneSloReadSpy).not.toHaveBeenCalled();
    expect(locks.events).toEqual([]);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("tells the caller of the one-SLO add each rule as it is added", async () => {
    const told: Array<string> = [];

    await ServiceLevelObjectiveBurnRateRuleService.addMissingRecommendedRules({
      serviceLevelObjectiveId: SLO_B,
      props: caller(),
      onRuleAdded: (rule: SloAddedRecommendedRule): void => {
        told.push(rule.recommended.name);
      },
    });

    expect(told).toEqual(["Fast burn", "Slow burn", "Slow leak"]);
  });
});

describe("what the bulk routes read a failure as", () => {
  it("the caller may not: not found, not allowed, not signed in, forbidden, or not on the plan", () => {
    for (const refusal of [
      new NotFoundException("Service Level Objective not found."),
      new NotAuthorizedException("No."),
      new NotAuthenticatedException("Sign in."),
      new ForbiddenException("Forbidden."),
      new PaymentRequiredException("Upgrade."),
    ]) {
      expect({ name: refusal.constructor.name, refused: true }).toEqual({
        name: refusal.constructor.name,
        refused: isSloBulkRefusal(refusal),
      });
    }
  });

  it("anything else broke", () => {
    for (const failure of [
      new BadDataException("Bad."),
      new ServerException("Down."),
      new Error("socket hang up"),
      "text",
      null,
    ]) {
      expect(isSloBulkRefusal(failure)).toBe(false);
    }
  });

  it("is said in OneUptime's own words, or in the generic sentence when it has none", () => {
    expect(getSloBulkErrorMessage(new BadDataException("Bad."))).toBe("Bad.");
    expect(getSloBulkErrorMessage(new ServerException("  "))).toBe(
      SLO_BULK_ADD_FAILED_MESSAGE,
    );
    expect(getSloBulkErrorMessage(new Error("socket hang up"))).toBe(
      SLO_BULK_ADD_FAILED_MESSAGE,
    );
    expect(getSloBulkErrorMessage(undefined)).toBe(SLO_BULK_ADD_FAILED_MESSAGE);
  });
});

describe("the SLOs a bulk request names", () => {
  it("are each SLO once, in the order first named, whatever the case of its id", () => {
    expect(
      getSloBulkIds([
        SLO_B,
        SLO_A,
        new ObjectID(SLO_B.toString().toUpperCase()),
        SLO_C,
      ]).map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([SLO_B.toString(), SLO_A.toString(), SLO_C.toString()]);
  });

  it("are at least one and at most the cap", () => {
    expect(() => {
      return getSloBulkIds([]);
    }).toThrow(SLO_BULK_NO_IDS_MESSAGE);
    expect(() => {
      return getSloBulkIds(
        manyIds(SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS + 1),
      );
    }).toThrow(SLO_BULK_TOO_MANY_MESSAGE);
    expect(
      getSloBulkIds(manyIds(SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS)),
    ).toHaveLength(SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS);
  });

  it("say the cap in their refusal, and what to do about it", () => {
    expect(SLO_BULK_TOO_MANY_MESSAGE).toBe(
      `serviceLevelObjectiveIds can name at most ${SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS} SLOs. Send the rest in another request.`,
    );
    expect(SLO_RECOMMENDED_BURN_RATE_RULES_BULK_MAX_SLOS).toBe(100);
  });
});
