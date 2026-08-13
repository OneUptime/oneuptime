import AlertService from "../../../Server/Services/AlertService";
import AlertSeverityService, {
  Service as AlertSeverityServiceClass,
} from "../../../Server/Services/AlertSeverityService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSeverityService, {
  Service as IncidentSeverityServiceClass,
} from "../../../Server/Services/IncidentSeverityService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../../Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserOnCallLog from "../../../Models/DatabaseModels/UserOnCallLog";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import PositiveNumber from "../../../Types/PositiveNumber";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import UserNotificationExecutionStatus from "../../../Types/UserNotification/UserNotificationExecutionStatus";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * GAP A — a severity created after a user joined is a severity that user has no
 * notification rule for, and nothing anywhere backfills one.
 *
 * The default rules a responder gets are written by
 * UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod(),
 * whose two severity-shaped halves — createIncidentOnCallRules() and
 * createAlertOnCallRules() — iterate the severities that exist AT THE MOMENT
 * THEY RUN. They run when a member joins a project, when a notification method
 * is verified, and in the MigrateDefaultUserNotificationRule migration. They do
 * NOT run when a severity is created, because neither IncidentSeverityService
 * nor AlertSeverityService defines any create-success hook at all: both stop at
 * onBeforeCreate, whose entire job is order rearrangement.
 *
 * So "add a Sev4 a year into the project" is a silent paging outage for every
 * existing user: UserOnCallLogService.onCreateSuccess counts rules with
 * { userId, projectId, ruleType, incidentSeverityId }, gets zero, writes
 * "No notification rules found for this user." into an execution log nobody
 * reads, and returns without paging anyone.
 *
 * This file pins that behaviour in three layers:
 *
 *   (A) Neither severity service touches UserNotificationRuleService. Proven
 *       structurally (the create-side hooks they override, and the fact that
 *       onCreateSuccess is still DatabaseService's placeholder) and
 *       behaviourally (drive every hook they DO define; assert zero rules).
 *   (B) Rule creation is severity-snapshot-driven. The same user, the same
 *       project, run once against two severities and once against three, and
 *       the third severity only ever gets a rule because the method was called
 *       a SECOND time — which nothing does when a severity is created.
 *   (C) The resulting hole, asserted through the real runtime query. A user with
 *       rules for [A, B] and a project with severities [A, B, C] has zero rules
 *       matching a C-severity incident, so the page is dropped.
 *
 * Sections A and B are the buggy-by-design half. Every assertion carrying the
 * "GAP A" banner is one Phase 1 is expected to INVERT once the backfill lands.
 */

const PROJECT_ID: ObjectID = new ObjectID("project-1");
const USER_ID: ObjectID = new ObjectID("user-1");
const USER_EMAIL_ID: ObjectID = new ObjectID("user-email-1");
const LOG_ID: ObjectID = new ObjectID("oncall-log-1");
const TIMELINE_ID: ObjectID = new ObjectID("timeline-1");
const INCIDENT_ID: ObjectID = new ObjectID("incident-1");
const ALERT_ID: ObjectID = new ObjectID("alert-1");

// The two severities that existed when the user joined, and the late arrival.
const SEV_A: ObjectID = new ObjectID("incident-severity-A");
const SEV_B: ObjectID = new ObjectID("incident-severity-B");
const SEV_C: ObjectID = new ObjectID("incident-severity-C-added-later");

const ALERT_SEV_A: ObjectID = new ObjectID("alert-severity-A");
const ALERT_SEV_B: ObjectID = new ObjectID("alert-severity-B");
const ALERT_SEV_C: ObjectID = new ObjectID("alert-severity-C-added-later");

/*
 * ------------------------------------------------------------------------- *
 * A tiny in-memory stand-in for the UserNotificationRule table.
 *
 * Both halves of the gap are read through it: section B writes into it via the
 * real createIncidentOnCallRules()/createAlertOnCallRules() code paths, and
 * section C then queries it with exactly the shape UserOnCallLogService uses.
 * That is deliberate — the coverage hole is only meaningful if the rows the
 * writer produced are the rows the reader misses.
 * -------------------------------------------------------------------------
 */

interface StoredRule {
  id: ObjectID;
  projectId: string | undefined;
  userId: string | undefined;
  ruleType: NotificationRuleType | undefined;
  incidentSeverityId: string | undefined;
  alertSeverityId: string | undefined;
  notifyAfterMinutes: number | undefined;
  userEmailId: string | undefined;
}

let ruleStore: Array<StoredRule> = [];

function toIdString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return String(value);
}

/*
 * Match a stored row against a service query. A key the query does not carry is
 * not a constraint — that mirrors how the real queries are built, where
 * createSingleRule simply omits the severity columns and UserOnCallLogService
 * passes `alertSeverityId: undefined` on the incident path.
 */
function ruleMatchesQuery(
  rule: StoredRule,
  query: Record<string, unknown>,
): boolean {
  const idFields: Array<keyof StoredRule> = [
    "projectId",
    "userId",
    "incidentSeverityId",
    "alertSeverityId",
    "userEmailId",
  ];

  for (const field of idFields) {
    const expected: string | undefined = toIdString(query[field as string]);

    if (expected !== undefined && toIdString(rule[field]) !== expected) {
      return false;
    }
  }

  const expectedRuleType: unknown = query["ruleType"];

  if (expectedRuleType !== undefined && rule.ruleType !== expectedRuleType) {
    return false;
  }

  const expectedNotifyAfterMinutes: unknown = query["notifyAfterMinutes"];

  if (
    expectedNotifyAfterMinutes !== undefined &&
    rule.notifyAfterMinutes !== expectedNotifyAfterMinutes
  ) {
    return false;
  }

  return true;
}

function matchingRules(query: Record<string, unknown>): Array<StoredRule> {
  return ruleStore.filter((rule: StoredRule): boolean => {
    return ruleMatchesQuery(rule, query);
  });
}

/* Remove a column the way a request that simply omitted it would. */
function unsetColumn(model: Record<string, unknown>, column: string): void {
  Reflect.deleteProperty(model, column);
}

// Calls a protected hook without widening the service's public surface.
function callHook(
  service: unknown,
  name: string,
  ...args: Array<unknown>
): Promise<unknown> {
  const hooks: Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  > = service as Record<
    string,
    (...hookArgs: Array<unknown>) => Promise<unknown>
  >;

  return hooks[name]!.apply(service, args);
}

function ownHookNames(prototype: Record<string, unknown>): Array<string> {
  return Object.getOwnPropertyNames(prototype)
    .filter((name: string): boolean => {
      return name.startsWith("on");
    })
    .sort();
}

function incidentSeverityRows(ids: Array<ObjectID>): Array<IncidentSeverity> {
  return ids.map((id: ObjectID): IncidentSeverity => {
    const severity: IncidentSeverity = new IncidentSeverity();
    severity._id = id.toString();
    severity.projectId = PROJECT_ID;

    return severity;
  });
}

function alertSeverityRows(ids: Array<ObjectID>): Array<AlertSeverity> {
  return ids.map((id: ObjectID): AlertSeverity => {
    const severity: AlertSeverity = new AlertSeverity();
    severity._id = id.toString();
    severity.projectId = PROJECT_ID;

    return severity;
  });
}

/* Wire the store into the service's own read/write helpers. */
function stubUserNotificationRuleStore(): void {
  jest
    .spyOn(UserNotificationRuleService, "findOneBy")
    .mockImplementation(((data: {
      query: Record<string, unknown>;
    }): Promise<UserNotificationRule | null> => {
      const match: StoredRule | undefined = matchingRules(data.query)[0];

      if (!match) {
        return Promise.resolve(null);
      }

      const model: UserNotificationRule = new UserNotificationRule();
      model._id = match.id.toString();

      return Promise.resolve(model);
    }) as never);

  jest.spyOn(UserNotificationRuleService, "findBy").mockImplementation(((data: {
    query: Record<string, unknown>;
  }): Promise<Array<UserNotificationRule>> => {
    return Promise.resolve(
      matchingRules(data.query).map(
        (stored: StoredRule): UserNotificationRule => {
          const model: UserNotificationRule = new UserNotificationRule();
          model._id = stored.id.toString();

          return model;
        },
      ),
    );
  }) as never);

  jest
    .spyOn(UserNotificationRuleService, "countBy")
    .mockImplementation(((data: {
      query: Record<string, unknown>;
    }): Promise<PositiveNumber> => {
      return Promise.resolve(
        new PositiveNumber(matchingRules(data.query).length),
      );
    }) as never);

  jest.spyOn(UserNotificationRuleService, "create").mockImplementation(((data: {
    data: UserNotificationRule;
  }): Promise<UserNotificationRule> => {
    const model: UserNotificationRule = data.data;
    const id: ObjectID = new ObjectID(`rule-${ruleStore.length + 1}`);
    model._id = id.toString();

    ruleStore.push({
      id: id,
      projectId: toIdString(model.projectId),
      userId: toIdString(model.userId),
      ruleType: model.ruleType,
      incidentSeverityId: toIdString(model.incidentSeverityId),
      alertSeverityId: toIdString(model.alertSeverityId),
      notifyAfterMinutes: model.notifyAfterMinutes,
      userEmailId: toIdString(model.userEmailId),
    });

    return Promise.resolve(model);
  }) as never);
}

/* The severities the project has AT THIS MOMENT. */
function stubSeverities(
  incidentSeverityIds: Array<ObjectID>,
  alertSeverityIds: Array<ObjectID>,
): void {
  jest
    .spyOn(IncidentSeverityService, "findBy")
    .mockResolvedValue(incidentSeverityRows(incidentSeverityIds) as never);
  jest
    .spyOn(AlertSeverityService, "findBy")
    .mockResolvedValue(alertSeverityRows(alertSeverityIds) as never);
}

function runDefaults(): Promise<void> {
  return UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod(
    {
      projectId: PROJECT_ID,
      userId: USER_ID,
      notificationMethod: {
        userEmailId: USER_EMAIL_ID,
      },
    },
  );
}

function rulesOfType(ruleType: NotificationRuleType): Array<StoredRule> {
  return ruleStore.filter((rule: StoredRule): boolean => {
    return rule.ruleType === ruleType;
  });
}

function incidentSeverityIdsCovered(): Array<string | undefined> {
  return rulesOfType(NotificationRuleType.ON_CALL_EXECUTED_INCIDENT).map(
    (rule: StoredRule): string | undefined => {
      return rule.incidentSeverityId;
    },
  );
}

function alertSeverityIdsCovered(): Array<string | undefined> {
  return rulesOfType(NotificationRuleType.ON_CALL_EXECUTED_ALERT).map(
    (rule: StoredRule): string | undefined => {
      return rule.alertSeverityId;
    },
  );
}

beforeEach(() => {
  ruleStore = [];
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * ========================================================================= *
 * (A) Neither severity service has anything to do with notification rules.
 * =========================================================================
 */

describe("GAP A - IncidentSeverityService defines no rule-backfilling create hook", () => {
  let createSpy: jest.SpyInstance;
  let addDefaultsForMethodSpy: jest.SpyInstance;
  let addDefaultsForUserSpy: jest.SpyInstance;

  beforeEach(() => {
    /*
     * onBeforeCreate's only real work is order rearrangement, which reads and
     * rewrites sibling rows. Stub both so the hook is drivable without a
     * database.
     */
    jest
      .spyOn(IncidentSeverityService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(IncidentSeverityService, "updateOneBy")
      .mockResolvedValue(0 as never);

    createSpy = jest
      .spyOn(UserNotificationRuleService, "create")
      .mockResolvedValue(new UserNotificationRule() as never);
    addDefaultsForMethodSpy = jest
      .spyOn(
        UserNotificationRuleService,
        "addDefaultNotificationRulesForVerifiedMethod",
      )
      .mockResolvedValue(undefined as never);
    addDefaultsForUserSpy = jest
      .spyOn(UserNotificationRuleService, "addDefaultNotificationRuleForUser")
      .mockResolvedValue(undefined as never);
  });

  function createBySeverity(): CreateBy<IncidentSeverity> {
    const severity: IncidentSeverity = new IncidentSeverity();
    severity.name = "Sev4";
    severity.order = 4;
    severity.projectId = PROJECT_ID;

    return {
      data: severity,
      props: { isRoot: true },
    } as CreateBy<IncidentSeverity>;
  }

  function expectNoRuleCreation(): void {
    expect(createSpy).not.toHaveBeenCalled();
    expect(addDefaultsForMethodSpy).not.toHaveBeenCalled();
    expect(addDefaultsForUserSpy).not.toHaveBeenCalled();
  }

  /*
   * GAP A - Phase 1 adds the backfill; this assertion inverts. Once
   * IncidentSeverityService gains an onCreateSuccess that mirrors each existing
   * user's methods onto the new severity, "onCreateSuccess" joins this list.
   */
  test("the only create-side hook it overrides is onBeforeCreate", () => {
    expect(ownHookNames(IncidentSeverityServiceClass.prototype)).toEqual([
      "onBeforeCreate",
      "onBeforeDelete",
      "onBeforeUpdate",
      "onDeleteSuccess",
    ]);
  });

  /*
   * GAP A - Phase 1 adds the backfill; this assertion inverts. Sharing
   * DatabaseService's identity is the precise statement of "does nothing":
   * the inherited placeholder returns the created item and stops.
   */
  test("onCreateSuccess is still DatabaseService's do-nothing placeholder", () => {
    const proto: Record<string, unknown> =
      IncidentSeverityServiceClass.prototype as unknown as Record<
        string,
        unknown
      >;
    const base: Record<string, unknown> =
      DatabaseService.prototype as unknown as Record<string, unknown>;

    expect(proto["onCreateSuccess"]).toBe(base["onCreateSuccess"]);
    expect(
      Object.prototype.hasOwnProperty.call(
        IncidentSeverityServiceClass.prototype,
        "onCreateSuccess",
      ),
    ).toBe(false);
  });

  test("it does not override onCreateError either, so there is no rule work on the failure path", () => {
    expect(
      Object.prototype.hasOwnProperty.call(
        IncidentSeverityServiceClass.prototype,
        "onCreateError",
      ),
    ).toBe(false);
  });

  /*
   * GAP A - Phase 1 adds the backfill; this assertion inverts.
   */
  test("driving onBeforeCreate for a brand new severity creates no notification rules", async () => {
    await callHook(
      IncidentSeverityService,
      "onBeforeCreate",
      createBySeverity(),
    );

    expectNoRuleCreation();
  });

  test("onBeforeCreate only rearranges sibling order - that is its whole job", async () => {
    const findBySpy: jest.SpyInstance = jest.spyOn(
      IncidentSeverityService,
      "findBy",
    );

    await callHook(
      IncidentSeverityService,
      "onBeforeCreate",
      createBySeverity(),
    );

    expect(findBySpy).toHaveBeenCalledTimes(1);
    expectNoRuleCreation();
  });

  /*
   * GAP A - Phase 1 adds the backfill; this assertion inverts. Driving the full
   * create sequence (before-hook then success-hook) is the behavioural proof:
   * the severity row is committed and not one rule follows it.
   */
  test("the full create sequence (onBeforeCreate then onCreateSuccess) creates no rules", async () => {
    const createBy: CreateBy<IncidentSeverity> = createBySeverity();

    const onCreate: OnCreate<IncidentSeverity> = (await callHook(
      IncidentSeverityService,
      "onBeforeCreate",
      createBy,
    )) as OnCreate<IncidentSeverity>;

    const created: IncidentSeverity = new IncidentSeverity();
    created._id = SEV_C.toString();
    created.projectId = PROJECT_ID;

    const returned: unknown = await callHook(
      IncidentSeverityService,
      "onCreateSuccess",
      onCreate,
      created,
    );

    // The placeholder hands the created item straight back, untouched.
    expect(returned).toBe(created);
    expectNoRuleCreation();
  });

  test("a severity with no order is rejected, and still nothing touches rules", async () => {
    const createBy: CreateBy<IncidentSeverity> = createBySeverity();
    unsetColumn(createBy.data, "order");

    await expect(
      callHook(IncidentSeverityService, "onBeforeCreate", createBy),
    ).rejects.toBeInstanceOf(BadDataException);

    expectNoRuleCreation();
  });

  test("a severity with no projectId is rejected, and still nothing touches rules", async () => {
    const createBy: CreateBy<IncidentSeverity> = createBySeverity();
    unsetColumn(createBy.data, "projectId");

    await expect(
      callHook(IncidentSeverityService, "onBeforeCreate", createBy),
    ).rejects.toBeInstanceOf(BadDataException);

    expectNoRuleCreation();
  });

  /*
   * GAP A - Phase 1 adds the backfill; this assertion inverts. This is the
   * user-visible consequence stated as a test: however many people are already
   * in the project, creating a severity considers none of them.
   */
  test("three existing project users are all left uncovered by the new severity", async () => {
    const createBy: CreateBy<IncidentSeverity> = createBySeverity();

    const onCreate: OnCreate<IncidentSeverity> = (await callHook(
      IncidentSeverityService,
      "onBeforeCreate",
      createBy,
    )) as OnCreate<IncidentSeverity>;

    const created: IncidentSeverity = new IncidentSeverity();
    created._id = SEV_C.toString();
    created.projectId = PROJECT_ID;

    await callHook(
      IncidentSeverityService,
      "onCreateSuccess",
      onCreate,
      created,
    );

    /*
     * Nothing enumerated the project's users at all - no TeamMember read, no
     * per-user method lookup, no rule write. The count of users is irrelevant
     * precisely because the code never asks.
     */
    expect(addDefaultsForMethodSpy).toHaveBeenCalledTimes(0);
    expect(createSpy).toHaveBeenCalledTimes(0);
  });
});

describe("GAP A - AlertSeverityService defines no rule-backfilling create hook", () => {
  let createSpy: jest.SpyInstance;
  let addDefaultsForMethodSpy: jest.SpyInstance;
  let addDefaultsForUserSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(AlertSeverityService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(AlertSeverityService, "updateOneBy")
      .mockResolvedValue(0 as never);

    createSpy = jest
      .spyOn(UserNotificationRuleService, "create")
      .mockResolvedValue(new UserNotificationRule() as never);
    addDefaultsForMethodSpy = jest
      .spyOn(
        UserNotificationRuleService,
        "addDefaultNotificationRulesForVerifiedMethod",
      )
      .mockResolvedValue(undefined as never);
    addDefaultsForUserSpy = jest
      .spyOn(UserNotificationRuleService, "addDefaultNotificationRuleForUser")
      .mockResolvedValue(undefined as never);
  });

  function createBySeverity(): CreateBy<AlertSeverity> {
    const severity: AlertSeverity = new AlertSeverity();
    severity.name = "Sev4";
    severity.order = 4;
    severity.projectId = PROJECT_ID;

    return {
      data: severity,
      props: { isRoot: true },
    } as CreateBy<AlertSeverity>;
  }

  function expectNoRuleCreation(): void {
    expect(createSpy).not.toHaveBeenCalled();
    expect(addDefaultsForMethodSpy).not.toHaveBeenCalled();
    expect(addDefaultsForUserSpy).not.toHaveBeenCalled();
  }

  /*
   * GAP A - Phase 1 adds the backfill; this assertion inverts.
   */
  test("the only create-side hook it overrides is onBeforeCreate", () => {
    expect(ownHookNames(AlertSeverityServiceClass.prototype)).toEqual([
      "onBeforeCreate",
      "onBeforeDelete",
      "onBeforeUpdate",
      "onDeleteSuccess",
    ]);
  });

  /*
   * GAP A - Phase 1 adds the backfill; this assertion inverts.
   */
  test("onCreateSuccess is still DatabaseService's do-nothing placeholder", () => {
    const proto: Record<string, unknown> =
      AlertSeverityServiceClass.prototype as unknown as Record<string, unknown>;
    const base: Record<string, unknown> =
      DatabaseService.prototype as unknown as Record<string, unknown>;

    expect(proto["onCreateSuccess"]).toBe(base["onCreateSuccess"]);
    expect(
      Object.prototype.hasOwnProperty.call(
        AlertSeverityServiceClass.prototype,
        "onCreateSuccess",
      ),
    ).toBe(false);
  });

  /*
   * GAP A - Phase 1 adds the backfill; this assertion inverts.
   */
  test("the full create sequence (onBeforeCreate then onCreateSuccess) creates no rules", async () => {
    const createBy: CreateBy<AlertSeverity> = createBySeverity();

    const onCreate: OnCreate<AlertSeverity> = (await callHook(
      AlertSeverityService,
      "onBeforeCreate",
      createBy,
    )) as OnCreate<AlertSeverity>;

    const created: AlertSeverity = new AlertSeverity();
    created._id = ALERT_SEV_C.toString();
    created.projectId = PROJECT_ID;

    const returned: unknown = await callHook(
      AlertSeverityService,
      "onCreateSuccess",
      onCreate,
      created,
    );

    expect(returned).toBe(created);
    expectNoRuleCreation();
  });

  test("a severity with no order is rejected, and still nothing touches rules", async () => {
    const createBy: CreateBy<AlertSeverity> = createBySeverity();
    unsetColumn(createBy.data, "order");

    await expect(
      callHook(AlertSeverityService, "onBeforeCreate", createBy),
    ).rejects.toBeInstanceOf(BadDataException);

    expectNoRuleCreation();
  });

  test("a severity with no projectId is rejected, and still nothing touches rules", async () => {
    const createBy: CreateBy<AlertSeverity> = createBySeverity();
    unsetColumn(createBy.data, "projectId");

    await expect(
      callHook(AlertSeverityService, "onBeforeCreate", createBy),
    ).rejects.toBeInstanceOf(BadDataException);

    expectNoRuleCreation();
  });
});

/*
 * ========================================================================= *
 * (B) Rule creation is a snapshot of the severities that exist at call time.
 * =========================================================================
 */

describe("GAP A - default rules are a snapshot of the severities that exist at call time", () => {
  beforeEach(() => {
    stubUserNotificationRuleStore();
  });

  test("a two-severity project produces exactly one incident rule per existing severity", async () => {
    stubSeverities([SEV_A, SEV_B], []);

    await runDefaults();

    expect(incidentSeverityIdsCovered()).toEqual([
      SEV_A.toString(),
      SEV_B.toString(),
    ]);
  });

  test("a severity that does not exist yet gets no rule - there is nothing to iterate", async () => {
    stubSeverities([SEV_A, SEV_B], []);

    await runDefaults();

    expect(incidentSeverityIdsCovered()).not.toContain(SEV_C.toString());
  });

  test("alert severities behave identically", async () => {
    stubSeverities([], [ALERT_SEV_A, ALERT_SEV_B]);

    await runDefaults();

    expect(alertSeverityIdsCovered()).toEqual([
      ALERT_SEV_A.toString(),
      ALERT_SEV_B.toString(),
    ]);
    expect(alertSeverityIdsCovered()).not.toContain(ALERT_SEV_C.toString());
  });

  test("each severity rule is an immediate rule of the right type bound to the verified method", async () => {
    stubSeverities([SEV_A], [ALERT_SEV_A]);

    await runDefaults();

    const incidentRule: StoredRule = rulesOfType(
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    )[0]!;

    expect(incidentRule.projectId).toBe(PROJECT_ID.toString());
    expect(incidentRule.userId).toBe(USER_ID.toString());
    expect(incidentRule.userEmailId).toBe(USER_EMAIL_ID.toString());
    expect(incidentRule.notifyAfterMinutes).toBe(0);
    expect(incidentRule.incidentSeverityId).toBe(SEV_A.toString());
    expect(incidentRule.alertSeverityId).toBeUndefined();

    const alertRule: StoredRule = rulesOfType(
      NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    )[0]!;

    expect(alertRule.alertSeverityId).toBe(ALERT_SEV_A.toString());
    expect(alertRule.incidentSeverityId).toBeUndefined();
    expect(alertRule.notifyAfterMinutes).toBe(0);
  });

  test("the four non-severity rule types are created regardless of how many severities exist", async () => {
    stubSeverities([], []);

    await runDefaults();

    expect(
      rulesOfType(NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE),
    ).toHaveLength(1);
    expect(
      rulesOfType(NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE),
    ).toHaveLength(1);
    expect(
      rulesOfType(NotificationRuleType.WHEN_USER_GOES_ON_CALL),
    ).toHaveLength(1);
    expect(
      rulesOfType(NotificationRuleType.WHEN_USER_GOES_OFF_CALL),
    ).toHaveLength(1);
  });

  test("a project with no severities yields only the four fixed rules - no severity coverage at all", async () => {
    stubSeverities([], []);

    await runDefaults();

    expect(ruleStore).toHaveLength(4);
    expect(incidentSeverityIdsCovered()).toEqual([]);
    expect(alertSeverityIdsCovered()).toEqual([]);
  });

  test("two incident and two alert severities yield 2 + 2 + 4 rows", async () => {
    stubSeverities([SEV_A, SEV_B], [ALERT_SEV_A, ALERT_SEV_B]);

    await runDefaults();

    expect(ruleStore).toHaveLength(8);
  });

  test("the severity lookup is project-scoped, root-privileged and capped at LIMIT_PER_PROJECT", async () => {
    stubSeverities([SEV_A], [ALERT_SEV_A]);

    await runDefaults();

    const incidentFindBy: jest.SpyInstance = jest.spyOn(
      IncidentSeverityService,
      "findBy",
    );
    const findArg: {
      query: { projectId: ObjectID };
      props: { isRoot: boolean };
      limit: number;
      skip: number;
    } = incidentFindBy.mock.calls[0]![0] as {
      query: { projectId: ObjectID };
      props: { isRoot: boolean };
      limit: number;
      skip: number;
    };

    expect(findArg.query.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(findArg.props.isRoot).toBe(true);
    expect(findArg.limit).toBe(LIMIT_PER_PROJECT);
    expect(findArg.skip).toBe(0);
  });

  test("running twice against the same severities is idempotent - no duplicate rows", async () => {
    stubSeverities([SEV_A, SEV_B], [ALERT_SEV_A, ALERT_SEV_B]);

    await runDefaults();
    const afterFirstRun: number = ruleStore.length;

    await runDefaults();

    expect(ruleStore).toHaveLength(afterFirstRun);
  });

  /*
   * GAP A - Phase 1 adds the backfill; this assertion inverts.
   *
   * The heart of it. Call one: severities [A, B]. A third severity C is then
   * created in the project. Call two: severities [A, B, C] - and only NOW does
   * the C rule appear. Nothing in the product makes call two happen when a
   * severity is created, so in production the store stays frozen at [A, B].
   */
  test("a third severity only gets a rule because the method was called a SECOND time", async () => {
    stubSeverities([SEV_A, SEV_B], []);
    await runDefaults();

    // Snapshot taken by call one: the user is covered for A and B only.
    expect(incidentSeverityIdsCovered()).toEqual([
      SEV_A.toString(),
      SEV_B.toString(),
    ]);

    /*
     * "Sev4" is created here. In production this is a plain
     * IncidentSeverityService.create() and nothing else happens - see the
     * section (A) tests above. The only reason C appears below is that this
     * test explicitly re-runs the defaults, which the product never does.
     */
    stubSeverities([SEV_A, SEV_B, SEV_C], []);
    await runDefaults();

    expect(incidentSeverityIdsCovered()).toEqual([
      SEV_A.toString(),
      SEV_B.toString(),
      SEV_C.toString(),
    ]);
  });

  test("the re-run adds exactly one row - the pre-existing severities are skipped", async () => {
    stubSeverities([SEV_A, SEV_B], []);
    await runDefaults();
    const afterFirstRun: number = ruleStore.length;

    stubSeverities([SEV_A, SEV_B, SEV_C], []);
    await runDefaults();

    expect(ruleStore.length - afterFirstRun).toBe(1);
    expect(
      rulesOfType(NotificationRuleType.ON_CALL_EXECUTED_INCIDENT),
    ).toHaveLength(3);
  });

  /*
   * GAP A - Phase 1 adds the backfill; this assertion inverts.
   */
  test("a late alert severity is missed the same way", async () => {
    stubSeverities([], [ALERT_SEV_A, ALERT_SEV_B]);
    await runDefaults();

    expect(alertSeverityIdsCovered()).toEqual([
      ALERT_SEV_A.toString(),
      ALERT_SEV_B.toString(),
    ]);

    // Severity C is created in the project. No rule work is triggered by that.
    stubSeverities([], [ALERT_SEV_A, ALERT_SEV_B]);

    expect(alertSeverityIdsCovered()).not.toContain(ALERT_SEV_C.toString());
  });

  test("the existing-rule check is severity-specific, so a rule for A never satisfies C", async () => {
    stubSeverities([SEV_A], []);
    await runDefaults();

    const findOneBySpy: jest.SpyInstance = jest.spyOn(
      UserNotificationRuleService,
      "findOneBy",
    );

    const severityQueries: Array<Record<string, unknown>> =
      findOneBySpy.mock.calls
        .map((call: Array<unknown>): Record<string, unknown> => {
          return (call[0] as { query: Record<string, unknown> }).query;
        })
        .filter((query: Record<string, unknown>): boolean => {
          return (
            query["ruleType"] === NotificationRuleType.ON_CALL_EXECUTED_INCIDENT
          );
        });

    expect(severityQueries).toHaveLength(1);
    expect(toIdString(severityQueries[0]!["incidentSeverityId"])).toBe(
      SEV_A.toString(),
    );
  });
});

/*
 * ========================================================================= *
 * (C) The coverage hole, read through the query UserOnCallLogService really
 *     issues: { userId, projectId, ruleType, incidentSeverityId }.
 *
 *     This section is the documented expectation Phase 1 has to satisfy. Today
 *     a C-severity incident finds zero rules and the page is dropped into an
 *     execution log; after the backfill (or the verified-method fallback) the
 *     same scenario must page somebody.
 * =========================================================================
 */

describe("GAP A - a severity added after the fact pages nobody", () => {
  let logUpdateSpy: jest.SpyInstance;
  let timelineUpdateSpy: jest.SpyInstance;
  let executeRuleSpy: jest.SpyInstance;

  beforeEach(async () => {
    stubUserNotificationRuleStore();

    // The user joined when the project had severities A and B only.
    stubSeverities([SEV_A, SEV_B], [ALERT_SEV_A, ALERT_SEV_B]);
    await runDefaults();

    logUpdateSpy = jest
      .spyOn(UserOnCallLogService, "updateOneById")
      .mockResolvedValue(1 as never);
    timelineUpdateSpy = jest
      .spyOn(OnCallDutyPolicyExecutionLogTimelineService, "updateOneById")
      .mockResolvedValue(1 as never);
    executeRuleSpy = jest
      .spyOn(UserNotificationRuleService, "executeNotificationRuleItem")
      .mockResolvedValue(undefined as never);
  });

  function stubIncident(incidentSeverityId: ObjectID): void {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockImplementation(((): Promise<Incident> => {
        const incident: Incident = new Incident();
        incident._id = INCIDENT_ID.toString();
        incident.incidentSeverityId = incidentSeverityId;

        return Promise.resolve(incident);
      }) as never);
  }

  function stubAlert(alertSeverityId: ObjectID): void {
    jest
      .spyOn(AlertService, "findOneById")
      .mockImplementation(((): Promise<Alert> => {
        const alert: Alert = new Alert();
        alert._id = ALERT_ID.toString();
        alert.alertSeverityId = alertSeverityId;

        return Promise.resolve(alert);
      }) as never);
  }

  function incidentOnCallLog(): UserOnCallLog {
    const log: UserOnCallLog = new UserOnCallLog();
    log._id = LOG_ID.toString();
    log.projectId = PROJECT_ID;
    log.userId = USER_ID;
    log.triggeredByIncidentId = INCIDENT_ID;
    log.userNotificationEventType = UserNotificationEventType.IncidentCreated;
    log.onCallDutyPolicyExecutionLogTimelineId = TIMELINE_ID;

    return log;
  }

  function alertOnCallLog(): UserOnCallLog {
    const log: UserOnCallLog = new UserOnCallLog();
    log._id = LOG_ID.toString();
    log.projectId = PROJECT_ID;
    log.userId = USER_ID;
    log.triggeredByAlertId = ALERT_ID;
    log.userNotificationEventType = UserNotificationEventType.AlertCreated;
    log.onCallDutyPolicyExecutionLogTimelineId = TIMELINE_ID;

    return log;
  }

  function driveOnCreateSuccess(log: UserOnCallLog): Promise<unknown> {
    const onCreate: OnCreate<UserOnCallLog> = {
      createBy: {
        data: log,
        props: { isRoot: true },
      } as CreateBy<UserOnCallLog>,
      carryForward: null,
    };

    return callHook(UserOnCallLogService, "onCreateSuccess", onCreate, log);
  }

  function statusUpdates(): Array<{
    status: UserNotificationExecutionStatus;
    statusMessage?: string | undefined;
  }> {
    return logUpdateSpy.mock.calls.map(
      (
        call: Array<unknown>,
      ): {
        status: UserNotificationExecutionStatus;
        statusMessage?: string | undefined;
      } => {
        return (
          call[0] as {
            data: {
              status: UserNotificationExecutionStatus;
              statusMessage?: string | undefined;
            };
          }
        ).data;
      },
    );
  }

  test("the runtime lookup keys on ruleType AND the incident's severity", async () => {
    stubIncident(SEV_C);
    const countBySpy: jest.SpyInstance = jest.spyOn(
      UserNotificationRuleService,
      "countBy",
    );

    await driveOnCreateSuccess(incidentOnCallLog());

    const query: Record<string, unknown> = (
      countBySpy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(toIdString(query["userId"])).toBe(USER_ID.toString());
    expect(toIdString(query["projectId"])).toBe(PROJECT_ID.toString());
    expect(query["ruleType"]).toBe(
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    );
    expect(toIdString(query["incidentSeverityId"])).toBe(SEV_C.toString());
  });

  /*
   * GAP A - Phase 1 adds the backfill; this assertion inverts. The whole point
   * of the gap in one line: rules exist for [A, B], the incident is C, the
   * count is zero.
   */
  test("a user with rules for [A, B] has ZERO rules matching a C-severity incident", async () => {
    const count: PositiveNumber = await UserNotificationRuleService.countBy({
      query: {
        userId: USER_ID,
        projectId: PROJECT_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        incidentSeverityId: SEV_C,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    } as never);

    expect(count.toNumber()).toBe(0);
  });

  test("the same user does have a rule for the severities that existed when they joined", async () => {
    const countForA: PositiveNumber = await UserNotificationRuleService.countBy(
      {
        query: {
          userId: USER_ID,
          projectId: PROJECT_ID,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: SEV_A,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: { isRoot: true },
      } as never,
    );

    expect(countForA.toNumber()).toBe(1);
  });

  /*
   * GAP A - Phase 1 adds the backfill; this assertion inverts.
   */
  test("the C-severity page is dropped: nobody is notified", async () => {
    stubIncident(SEV_C);

    await driveOnCreateSuccess(incidentOnCallLog());

    expect(executeRuleSpy).not.toHaveBeenCalled();
  });

  /*
   * GAP A - Phase 1 adds the backfill; this assertion inverts. Today the only
   * trace is an Error row in an execution log; Phase 1 turns this into a
   * fallback delivery (status Success) or an explicit, surfaced Error.
   */
  test("the drop is recorded as an execution-log Error, not as a notification", async () => {
    stubIncident(SEV_C);

    await driveOnCreateSuccess(incidentOnCallLog());

    const updates: Array<{
      status: UserNotificationExecutionStatus;
      statusMessage?: string | undefined;
    }> = statusUpdates();

    // First update marks it Started, second is the dead-end.
    expect(updates[0]!.status).toBe(UserNotificationExecutionStatus.Started);
    expect(updates[1]!.status).toBe(UserNotificationExecutionStatus.Error);
    expect(updates[1]!.statusMessage).toBe(
      "No notification rules found for this user. User should add the rules in User Settings > On-Call Rules.",
    );
    // It never reaches the Executing state, so no worker picks it up.
    expect(
      updates.some(
        (update: { status: UserNotificationExecutionStatus }): boolean => {
          return update.status === UserNotificationExecutionStatus.Executing;
        },
      ),
    ).toBe(false);
  });

  /*
   * GAP A - Phase 1 adds the backfill; this assertion inverts.
   */
  test("the on-call timeline shows Error with the same unread message", async () => {
    stubIncident(SEV_C);

    await driveOnCreateSuccess(incidentOnCallLog());

    expect(timelineUpdateSpy).toHaveBeenCalledTimes(1);
    const timelineArg: {
      id: ObjectID;
      data: {
        status: OnCallDutyExecutionLogTimelineStatus;
        statusMessage: string;
      };
    } = timelineUpdateSpy.mock.calls[0]![0] as {
      id: ObjectID;
      data: {
        status: OnCallDutyExecutionLogTimelineStatus;
        statusMessage: string;
      };
    };

    expect(timelineArg.id.toString()).toBe(TIMELINE_ID.toString());
    expect(timelineArg.data.status).toBe(
      OnCallDutyExecutionLogTimelineStatus.Error,
    );
    expect(timelineArg.data.statusMessage).toContain(
      "No notification rules found for this user",
    );
  });

  test("an incident on a severity that existed at join time pages the responder normally", async () => {
    stubIncident(SEV_A);

    await driveOnCreateSuccess(incidentOnCallLog());

    expect(executeRuleSpy).toHaveBeenCalledTimes(1);

    const updates: Array<{ status: UserNotificationExecutionStatus }> =
      statusUpdates();
    expect(updates[updates.length - 1]!.status).toBe(
      UserNotificationExecutionStatus.Executing,
    );
    expect(timelineUpdateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: OnCallDutyExecutionLogTimelineStatus.NotificationSent,
        }),
      }),
    );
  });

  test("the immediate-rule lookup is severity-filtered too, so there is no accidental fallback", async () => {
    stubIncident(SEV_A);
    const findBySpy: jest.SpyInstance = jest.spyOn(
      UserNotificationRuleService,
      "findBy",
    );

    await driveOnCreateSuccess(incidentOnCallLog());

    const query: Record<string, unknown> = (
      findBySpy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(query["notifyAfterMinutes"]).toBe(0);
    expect(query["ruleType"]).toBe(
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    );
    expect(toIdString(query["incidentSeverityId"])).toBe(SEV_A.toString());
    expect(query["alertSeverityId"]).toBeUndefined();
  });

  /*
   * GAP A - Phase 1 adds the backfill; this assertion inverts.
   */
  test("an ALERT on a severity added after the fact is dropped the same way", async () => {
    stubAlert(ALERT_SEV_C);

    await driveOnCreateSuccess(alertOnCallLog());

    expect(executeRuleSpy).not.toHaveBeenCalled();

    const updates: Array<{
      status: UserNotificationExecutionStatus;
      statusMessage?: string | undefined;
    }> = statusUpdates();
    expect(updates[1]!.status).toBe(UserNotificationExecutionStatus.Error);
  });

  test("an alert on a severity that existed at join time still pages", async () => {
    stubAlert(ALERT_SEV_A);

    await driveOnCreateSuccess(alertOnCallLog());

    expect(executeRuleSpy).toHaveBeenCalledTimes(1);
  });

  /*
   * The documented expectation for Phase 1, written as an executable target.
   *
   * The ONLY thing standing between "dropped" and "paged" is the presence of a
   * row for (userId, projectId, ON_CALL_EXECUTED_INCIDENT, SEV_C). Backfilling
   * that row on severity creation - exactly what section (A) proves does not
   * happen today - is sufficient to close the hole with no change to
   * UserOnCallLogService at all.
   */
  test("backfilling the missing row is sufficient: the very same C-severity incident then pages", async () => {
    stubIncident(SEV_C);

    // Re-running the defaults against a project that now has C is the backfill.
    stubSeverities([SEV_A, SEV_B, SEV_C], [ALERT_SEV_A, ALERT_SEV_B]);
    await runDefaults();

    await driveOnCreateSuccess(incidentOnCallLog());

    expect(executeRuleSpy).toHaveBeenCalledTimes(1);

    const updates: Array<{ status: UserNotificationExecutionStatus }> =
      statusUpdates();
    expect(updates[updates.length - 1]!.status).toBe(
      UserNotificationExecutionStatus.Executing,
    );
  });

  test("without the backfill the store simply has no row for the new severity", async () => {
    const rowsForC: Array<StoredRule> = matchingRules({
      userId: USER_ID,
      projectId: PROJECT_ID,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      incidentSeverityId: SEV_C,
    });

    expect(rowsForC).toHaveLength(0);

    // ... while the severities present at join time each have exactly one.
    expect(
      matchingRules({
        userId: USER_ID,
        projectId: PROJECT_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        incidentSeverityId: SEV_A,
      }),
    ).toHaveLength(1);
    expect(
      matchingRules({
        userId: USER_ID,
        projectId: PROJECT_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        incidentSeverityId: SEV_B,
      }),
    ).toHaveLength(1);
  });
});
