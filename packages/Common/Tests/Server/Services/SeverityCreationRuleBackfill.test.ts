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
import ProjectService from "../../../Server/Services/ProjectService";
import UserNotificationRuleService, {
  FallbackNotificationOutcome,
} from "../../../Server/Services/UserNotificationRuleService";
import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import UserService from "../../../Server/Services/UserService";
import Queue, { QueueName } from "../../../Server/Infrastructure/Queue";
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
 * GAP A — a severity created after a user joined was a severity that user had
 * no notification rule for, and nothing anywhere backfilled one.
 *
 * The default rules a responder gets are written by
 * UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod(),
 * whose two severity-shaped halves — createIncidentOnCallRules() and
 * createAlertOnCallRules() — iterate the severities that exist AT THE MOMENT
 * THEY RUN. They run when a member joins a project, when a notification method
 * is verified, and in the MigrateDefaultUserNotificationRule migration. They did
 * NOT run when a severity was created, because neither IncidentSeverityService
 * nor AlertSeverityService defined any create-success hook at all: both stopped
 * at onBeforeCreate, whose entire job is order rearrangement.
 *
 * So "add a Sev4 a year into the project" was a silent paging outage for every
 * existing user: UserOnCallLogService.onCreateSuccess counts rules with
 * { userId, projectId, ruleType, incidentSeverityId }, got zero, wrote
 * "No notification rules found for this user." into an execution log nobody
 * reads, and returned without paging anyone.
 *
 * PHASE 1 CLOSED THIS, on two independent fronts, and this file now pins both:
 *
 *   (A) Creating a severity enqueues
 *       "OnCallDutyPolicy:BackfillNotificationRulesForNewSeverities" onto the
 *       Worker queue. Proven structurally (onCreateSuccess is now an own
 *       property on both services, no longer DatabaseService's placeholder) and
 *       behaviourally (drive the hooks; assert the enqueue, its queue, its name
 *       and its payload). The fan-out itself stays OUT of the request — a
 *       project can hold thousands of responders — so "no rules written inline"
 *       is still asserted, but it no longer means "no backfill".
 *   (B) Rule creation is still severity-snapshot-driven, and that is fine now
 *       that something else revisits the snapshot. This section is unchanged: it
 *       documents why the backfill has to exist.
 *   (C) The runtime hole. A user with rules for [A, B] and a project with
 *       severities [A, B, C] still has zero rules matching a C-severity
 *       incident — but the page is no longer dropped. UserOnCallLogService now
 *       reaches for the verified-method fallback instead of the dead-end, so the
 *       responder is notified and the log says so.
 *
 * Assertions that used to carry the "GAP A" banner now carry "GAP A CLOSED" and
 * state the post-Phase-1 behaviour.
 */

/*
 * Mirrors the private constant in IncidentSeverityService / AlertSeverityService,
 * which in turn mirrors the RunCron job name in
 * App/FeatureSet/Workers/Jobs/OnCallDutyPolicy/BackfillNotificationRulesForNewSeverities.ts.
 * If a rename ever misses one of the three, this is where it surfaces.
 */
const BACKFILL_JOB_NAME: string =
  "OnCallDutyPolicy:BackfillNotificationRulesForNewSeverities";

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
  isOptOut: boolean | undefined;
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

  /*
   * isOptOut appears in queries in TWO different shapes, and conflating them
   * makes this matcher reject everything.
   *
   *   - As a literal `true`: the no-rule path's opt-out lookup, asking whether
   *     this exact (ruleType x severity) cell was deliberately muted.
   *   - As a PREDICATE OBJECT: every counting and execution query excludes
   *     opt-out rows with notOptOutRuleQuery(), which is
   *     QueryHelper.notInOrNull(["true"]) - a TypeORM operator, not a boolean.
   *     It is deliberately null-tolerant: isOptOut is nullable and every rule
   *     written before the column existed has it NULL, so a plain
   *     `isOptOut: false` would match none of them and quietly exclude every
   *     pre-existing rule from paging.
   *
   * A boolean is compared directly; anything else is the exclusion predicate,
   * which a row satisfies precisely when it is not an opt-out.
   */
  const expectedIsOptOut: unknown = query["isOptOut"];

  if (expectedIsOptOut !== undefined) {
    if (typeof expectedIsOptOut === "boolean") {
      if (Boolean(rule.isOptOut) !== expectedIsOptOut) {
        return false;
      }
    } else if (rule.isOptOut === true) {
      return false;
    }
  }

  return true;
}

function matchingRules(query: Record<string, unknown>): Array<StoredRule> {
  return ruleStore.filter((rule: StoredRule): boolean => {
    return ruleMatchesQuery(rule, query);
  });
}

/*
 * Remove a column the way a request that simply omitted it would.
 *
 * Takes `unknown` and narrows inside, the way callHook below does. Callers hand
 * it a model INSTANCE, and a class with declared properties is not assignable to
 * Record<string, unknown> under this repo's strict config - while `object` is
 * banned by the lint rules. Widening at the boundary satisfies both.
 */
function unsetColumn(model: unknown, column: string): void {
  Reflect.deleteProperty(model as Record<string, unknown>, column);
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

// Same reason as unsetColumn: callers pass a class prototype, not a map.
function ownHookNames(prototype: unknown): Array<string> {
  return Object.getOwnPropertyNames(prototype as Record<string, unknown>)
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
      isOptOut: model.isOptOut,
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
 * (A) Creating a severity now queues the backfill.
 *
 * GAP A CLOSED IN PHASE 1. This section used to prove the opposite: that
 * neither severity service had any create-success hook at all, and that
 * committing a severity row was followed by exactly nothing. Both services now
 * override onCreateSuccess and enqueue
 * "OnCallDutyPolicy:BackfillNotificationRulesForNewSeverities" onto the Worker
 * queue.
 *
 * Note what did NOT change, and why it is still asserted: no rule is written
 * inline. That is deliberate rather than residual. A project can hold thousands
 * of responders and this hook runs inside the request that created the
 * severity, so the fan-out belongs to the worker. "No inline rule creation" and
 * "no backfill" used to be the same observation; they are now opposites, and
 * the enqueue assertion is what tells them apart.
 * =========================================================================
 */

describe("GAP A CLOSED - IncidentSeverityService queues the rule backfill on create", () => {
  let createSpy: jest.SpyInstance;
  let addDefaultsForMethodSpy: jest.SpyInstance;
  let addDefaultsForUserSpy: jest.SpyInstance;
  let addJobSpy: jest.SpyInstance;

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

    // The queue is the hook's only side effect; never reach Redis for it.
    addJobSpy = jest.spyOn(Queue, "addJob").mockResolvedValue({} as never);

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

  function createdSeverity(): IncidentSeverity {
    const created: IncidentSeverity = new IncidentSeverity();
    created._id = SEV_C.toString();
    created.projectId = PROJECT_ID;

    return created;
  }

  function expectNoInlineRuleCreation(): void {
    expect(createSpy).not.toHaveBeenCalled();
    expect(addDefaultsForMethodSpy).not.toHaveBeenCalled();
    expect(addDefaultsForUserSpy).not.toHaveBeenCalled();
  }

  /*
   * GAP A CLOSED - onCreateSuccess is the hook Phase 1 added, so it now appears
   * in this list. The rest of the list is unchanged: the backfill hangs off the
   * success hook, not off any of the before-hooks.
   */
  test("it overrides onCreateSuccess alongside its ordering hooks", () => {
    expect(ownHookNames(IncidentSeverityServiceClass.prototype)).toEqual([
      "onBeforeCreate",
      "onBeforeDelete",
      "onBeforeUpdate",
      "onCreateSuccess",
      "onDeleteSuccess",
    ]);
  });

  /*
   * GAP A CLOSED - the inverse of the original assertion. Sharing
   * DatabaseService's identity was the precise statement of "does nothing"; a
   * distinct own property is the precise statement that it now does something.
   */
  test("onCreateSuccess is no longer DatabaseService's do-nothing placeholder", () => {
    const proto: Record<string, unknown> =
      IncidentSeverityServiceClass.prototype as unknown as Record<
        string,
        unknown
      >;
    const base: Record<string, unknown> =
      DatabaseService.prototype as unknown as Record<string, unknown>;

    expect(proto["onCreateSuccess"]).not.toBe(base["onCreateSuccess"]);
    expect(
      Object.prototype.hasOwnProperty.call(
        IncidentSeverityServiceClass.prototype,
        "onCreateSuccess",
      ),
    ).toBe(true);
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
   * GAP A CLOSED - the backfill hangs off onCreateSuccess, so the before-hook
   * on its own still queues nothing and writes nothing. A severity that fails
   * validation must not leave a backfill job behind for a row that was never
   * committed.
   */
  test("driving onBeforeCreate alone neither writes rules nor queues the backfill", async () => {
    await callHook(
      IncidentSeverityService,
      "onBeforeCreate",
      createBySeverity(),
    );

    expectNoInlineRuleCreation();
    expect(addJobSpy).not.toHaveBeenCalled();
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
    expectNoInlineRuleCreation();
  });

  /*
   * GAP A CLOSED - driving the full create sequence is the behavioural proof.
   * The severity row is committed and a backfill job follows it, on the Worker
   * queue, named for the cron that owns it.
   */
  test("the full create sequence queues the backfill job", async () => {
    const createBy: CreateBy<IncidentSeverity> = createBySeverity();

    const onCreate: OnCreate<IncidentSeverity> = (await callHook(
      IncidentSeverityService,
      "onBeforeCreate",
      createBy,
    )) as OnCreate<IncidentSeverity>;

    const created: IncidentSeverity = createdSeverity();

    const returned: unknown = await callHook(
      IncidentSeverityService,
      "onCreateSuccess",
      onCreate,
      created,
    );

    // The hook still hands the created item straight back.
    expect(returned).toBe(created);

    expect(addJobSpy).toHaveBeenCalledTimes(1);
    const call: Array<unknown> = addJobSpy.mock.calls[0]!;
    expect(call[0]).toBe(QueueName.Worker);
    expect(call[2]).toBe(BACKFILL_JOB_NAME);

    // Still nothing inline - the fan-out is the worker's job, not the request's.
    expectNoInlineRuleCreation();
  });

  /*
   * GAP A CLOSED - a queue that is unreachable must not take the severity down
   * with it. The scheduled sweep inside the backfill job re-scans recently
   * created severities, so a dropped enqueue costs latency, not coverage.
   */
  test("an enqueue failure is swallowed and the created item is still returned", async () => {
    addJobSpy.mockRejectedValue(new Error("redis is down") as never);

    const created: IncidentSeverity = createdSeverity();

    const returned: unknown = await callHook(
      IncidentSeverityService,
      "onCreateSuccess",
      { createBy: createBySeverity(), carryForward: null },
      created,
    );

    expect(returned).toBe(created);
  });

  test("a severity with no order is rejected, and still nothing touches rules", async () => {
    const createBy: CreateBy<IncidentSeverity> = createBySeverity();
    unsetColumn(createBy.data, "order");

    await expect(
      callHook(IncidentSeverityService, "onBeforeCreate", createBy),
    ).rejects.toBeInstanceOf(BadDataException);

    expectNoInlineRuleCreation();
  });

  test("a severity with no projectId is rejected, and still nothing touches rules", async () => {
    const createBy: CreateBy<IncidentSeverity> = createBySeverity();
    unsetColumn(createBy.data, "projectId");

    await expect(
      callHook(IncidentSeverityService, "onBeforeCreate", createBy),
    ).rejects.toBeInstanceOf(BadDataException);

    expectNoInlineRuleCreation();
  });

  /*
   * GAP A CLOSED - the user-visible consequence, inverted. However many people
   * are already in the project, creating a severity used to consider none of
   * them. It still enumerates none of them HERE, because it hands the whole
   * question to a job that carries the project and severity that changed.
   */
  test("the queued job names the project and severity whose responders need covering", async () => {
    const createBy: CreateBy<IncidentSeverity> = createBySeverity();

    const onCreate: OnCreate<IncidentSeverity> = (await callHook(
      IncidentSeverityService,
      "onBeforeCreate",
      createBy,
    )) as OnCreate<IncidentSeverity>;

    await callHook(
      IncidentSeverityService,
      "onCreateSuccess",
      onCreate,
      createdSeverity(),
    );

    expect(addJobSpy).toHaveBeenCalledTimes(1);
    const payload: Record<string, unknown> = addJobSpy.mock
      .calls[0]![3] as Record<string, unknown>;

    expect(payload["projectId"]).toBe(PROJECT_ID.toString());
    expect(payload["incidentSeverityId"]).toBe(SEV_C.toString());

    // The request itself still writes no rules and reads no users.
    expect(addDefaultsForMethodSpy).toHaveBeenCalledTimes(0);
    expect(createSpy).toHaveBeenCalledTimes(0);
  });
});

describe("GAP A CLOSED - AlertSeverityService queues the rule backfill on create", () => {
  let createSpy: jest.SpyInstance;
  let addDefaultsForMethodSpy: jest.SpyInstance;
  let addDefaultsForUserSpy: jest.SpyInstance;
  let addJobSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(AlertSeverityService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(AlertSeverityService, "updateOneBy")
      .mockResolvedValue(0 as never);

    addJobSpy = jest.spyOn(Queue, "addJob").mockResolvedValue({} as never);

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

  function expectNoInlineRuleCreation(): void {
    expect(createSpy).not.toHaveBeenCalled();
    expect(addDefaultsForMethodSpy).not.toHaveBeenCalled();
    expect(addDefaultsForUserSpy).not.toHaveBeenCalled();
  }

  /*
   * GAP A CLOSED - the alert half moves in lockstep with the incident half.
   */
  test("it overrides onCreateSuccess alongside its ordering hooks", () => {
    expect(ownHookNames(AlertSeverityServiceClass.prototype)).toEqual([
      "onBeforeCreate",
      "onBeforeDelete",
      "onBeforeUpdate",
      "onCreateSuccess",
      "onDeleteSuccess",
    ]);
  });

  /*
   * GAP A CLOSED - the inverse of the original assertion.
   */
  test("onCreateSuccess is no longer DatabaseService's do-nothing placeholder", () => {
    const proto: Record<string, unknown> =
      AlertSeverityServiceClass.prototype as unknown as Record<string, unknown>;
    const base: Record<string, unknown> =
      DatabaseService.prototype as unknown as Record<string, unknown>;

    expect(proto["onCreateSuccess"]).not.toBe(base["onCreateSuccess"]);
    expect(
      Object.prototype.hasOwnProperty.call(
        AlertSeverityServiceClass.prototype,
        "onCreateSuccess",
      ),
    ).toBe(true);
  });

  /*
   * GAP A CLOSED - the alert payload carries alertSeverityId, so the job can
   * tell which of the two severity tables changed without guessing.
   */
  test("the full create sequence queues the backfill job for the alert severity", async () => {
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

    expect(addJobSpy).toHaveBeenCalledTimes(1);
    const call: Array<unknown> = addJobSpy.mock.calls[0]!;
    expect(call[0]).toBe(QueueName.Worker);
    expect(call[2]).toBe(BACKFILL_JOB_NAME);

    const payload: Record<string, unknown> = call[3] as Record<string, unknown>;
    expect(payload["projectId"]).toBe(PROJECT_ID.toString());
    expect(payload["alertSeverityId"]).toBe(ALERT_SEV_C.toString());

    expectNoInlineRuleCreation();
  });

  test("a severity with no order is rejected, and still nothing touches rules", async () => {
    const createBy: CreateBy<AlertSeverity> = createBySeverity();
    unsetColumn(createBy.data, "order");

    await expect(
      callHook(AlertSeverityService, "onBeforeCreate", createBy),
    ).rejects.toBeInstanceOf(BadDataException);

    expectNoInlineRuleCreation();
  });

  test("a severity with no projectId is rejected, and still nothing touches rules", async () => {
    const createBy: CreateBy<AlertSeverity> = createBySeverity();
    unsetColumn(createBy.data, "projectId");

    await expect(
      callHook(AlertSeverityService, "onBeforeCreate", createBy),
    ).rejects.toBeInstanceOf(BadDataException);

    expectNoInlineRuleCreation();
  });
});

/*
 * ========================================================================= *
 * (B) Rule creation is a snapshot of the severities that exist at call time.
 *
 * Unchanged by Phase 1, and deliberately so: the fix was not to make this
 * method clairvoyant, it was to arrange for something to call it again. Every
 * assertion here still describes today's behaviour exactly.
 * =========================================================================
 */

describe("GAP A CLOSED - default rules are still a snapshot of the severities that exist at call time", () => {
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

  test("only the two go-on/off-call rule types survive a project with no severities", async () => {
    /*
     * GAP G CLOSED - the two EPISODE rule types are severity-scoped now.
     *
     * They used to be created by createSingleRule, which sets ruleType and
     * notifyAfterMinutes and no severity at all. That produced exactly one row
     * per rule type carrying a NULL severity - and UserOnCallLogService counts
     * episode rules filtered by a concrete severity id, so NULL never matched
     * and every one of those "defaults" was dead. Worse, both episode pages
     * scope their table by severity id, so the rows were invisible to the user
     * who owned them: unmatchable AND unfixable.
     *
     * So with zero severities in the project there is now nothing to scope an
     * episode rule TO, and none are written. Only WHEN_USER_GOES_ON_CALL and
     * WHEN_USER_GOES_OFF_CALL remain genuinely severity-less, because "I went
     * on call" is not an event that has a severity.
     */
    stubSeverities([], []);

    await runDefaults();

    expect(
      rulesOfType(NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE),
    ).toHaveLength(0);
    expect(
      rulesOfType(NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE),
    ).toHaveLength(0);
    expect(
      rulesOfType(NotificationRuleType.WHEN_USER_GOES_ON_CALL),
    ).toHaveLength(1);
    expect(
      rulesOfType(NotificationRuleType.WHEN_USER_GOES_OFF_CALL),
    ).toHaveLength(1);
  });

  test("a project with no severities yields only the two go-on/off-call rules", async () => {
    stubSeverities([], []);

    await runDefaults();

    expect(ruleStore).toHaveLength(2);
    expect(incidentSeverityIdsCovered()).toEqual([]);
    expect(alertSeverityIdsCovered()).toEqual([]);
  });

  test("two incident and two alert severities yield 2 + 2 + 2 + 2 + 2 rows", async () => {
    /*
     * Per severity: one incident rule, one alert rule, one incident-episode
     * rule and one alert-episode rule - eight in total across two of each
     * severity - plus the two severity-less go-on/off-call rules.
     */
    stubSeverities([SEV_A, SEV_B], [ALERT_SEV_A, ALERT_SEV_B]);

    await runDefaults();

    expect(ruleStore).toHaveLength(10);
    expect(
      rulesOfType(NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE),
    ).toHaveLength(2);
    expect(
      rulesOfType(NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE),
    ).toHaveLength(2);
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
   * GAP A CLOSED - this behaviour is unchanged, and it is exactly WHY the
   * backfill has to exist.
   *
   * Call one: severities [A, B]. A third severity C is then created in the
   * project. Call two: severities [A, B, C] - and only NOW does the C rule
   * appear. This method is still a snapshot of the moment it runs; what Phase 1
   * added is something that makes call two happen, namely the backfill job that
   * IncidentSeverityService.onCreateSuccess now enqueues.
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
     * "Sev4" is created here. In production creating it enqueues the backfill
     * job (see section (A)); this test stands in for that second pass by
     * re-running the defaults directly.
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

    /*
     * GAP G CLOSED - two rows, not one. A new incident severity now earns the
     * responder an ON_CALL_EXECUTED_INCIDENT rule AND an
     * ON_CALL_EXECUTED_INCIDENT_EPISODE rule, because episode rules are
     * severity-scoped now instead of a single severity-less row that could
     * never match.
     */
    expect(ruleStore.length - afterFirstRun).toBe(2);
    expect(
      rulesOfType(NotificationRuleType.ON_CALL_EXECUTED_INCIDENT),
    ).toHaveLength(3);
  });

  /*
   * GAP A CLOSED - the alert half of the same snapshot property. Unchanged, and
   * likewise the reason AlertSeverityService now enqueues the backfill too.
   */
  test("a late alert severity is missed by this method the same way", async () => {
    stubSeverities([], [ALERT_SEV_A, ALERT_SEV_B]);
    await runDefaults();

    expect(alertSeverityIdsCovered()).toEqual([
      ALERT_SEV_A.toString(),
      ALERT_SEV_B.toString(),
    ]);

    // Severity C is created in the project. This method alone does no rule work.
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
 *     The hole itself is unchanged - a user with rules for [A, B] still has no
 *     row for C until the backfill job runs - but the consequence is not. Phase
 *     1 replaced the dead-end with the verified-method fallback, so the very
 *     same C-severity incident now reaches the responder and the log records
 *     which channel carried it.
 * =========================================================================
 */

describe("GAP A CLOSED - a severity added after the fact still pages, via the fallback", () => {
  let logUpdateSpy: jest.SpyInstance;
  let timelineUpdateSpy: jest.SpyInstance;
  let executeRuleSpy: jest.SpyInstance;
  let fallbackSpy: jest.SpyInstance;

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

    /*
     * The three collaborators the no-rule path reaches for now. The project read
     * decides whether the fallback is allowed at all (null => allowed, the
     * default), the fallback itself reports which channels it dispatched on, and
     * the user read only ever feeds a name into a failure message.
     */
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(null as never);
    jest.spyOn(UserService, "findOneById").mockResolvedValue(null as never);
    fallbackSpy = jest
      .spyOn(UserNotificationRuleService, "executeFallbackNotification")
      .mockResolvedValue({
        notified: true,
        channelsUsed: ["Email"],
      } as never);
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
   * GAP A CLOSED - the count is still zero, and that is correct: the backfill
   * job has not run in this fixture. What changed is what a zero count now
   * causes, which the tests below assert. This one stays as the premise.
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
   * GAP A CLOSED - the C-severity page is no longer dropped. No RULE is
   * executed, because there is still no rule to execute; the fallback is what
   * carries it, and it is handed the same severity name and rule type the count
   * came up empty for.
   */
  test("the C-severity page reaches the responder through the fallback", async () => {
    stubIncident(SEV_C);

    await driveOnCreateSuccess(incidentOnCallLog());

    expect(executeRuleSpy).not.toHaveBeenCalled();
    expect(fallbackSpy).toHaveBeenCalledTimes(1);

    const options: Record<string, unknown> = fallbackSpy.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(toIdString(options["userId"])).toBe(USER_ID.toString());
    expect(toIdString(options["projectId"])).toBe(PROJECT_ID.toString());
    expect(options["ruleType"]).toBe(
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    );
  });

  /*
   * GAP A CLOSED - the inversion that matters most. The log used to end at
   * Error with a message nobody reads; it now ends at Executing with a message
   * that says a human was reached and on what.
   */
  test("the outcome is a fallback delivery, not a terminal Error", async () => {
    stubIncident(SEV_C);

    await driveOnCreateSuccess(incidentOnCallLog());

    const updates: Array<{
      status: UserNotificationExecutionStatus;
      statusMessage?: string | undefined;
    }> = statusUpdates();

    // First update marks it Started, second records the fallback delivery.
    expect(updates[0]!.status).toBe(UserNotificationExecutionStatus.Started);
    expect(updates[1]!.status).toBe(UserNotificationExecutionStatus.Executing);
    expect(updates[1]!.statusMessage).toContain("notified via fallback");
    expect(updates[1]!.statusMessage).toContain("Email");

    // The dead-end's sentence is gone from this path entirely.
    expect(
      updates.some(
        (update: { statusMessage?: string | undefined }): boolean => {
          return (
            update.statusMessage ===
            "No notification rules found for this user. User should add the rules in User Settings > On-Call Rules."
          );
        },
      ),
    ).toBe(false);
    expect(
      updates.some(
        (update: { status: UserNotificationExecutionStatus }): boolean => {
          return update.status === UserNotificationExecutionStatus.Error;
        },
      ),
    ).toBe(false);
  });

  /*
   * GAP A CLOSED - the timeline now reads as a delivery rather than a failure,
   * and it names the channel. An operator reading the escalation can tell that
   * somebody was reached and how.
   */
  test("the on-call timeline shows a notification sent through the fallback", async () => {
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
      OnCallDutyExecutionLogTimelineStatus.NotificationSent,
    );
    expect(timelineArg.data.statusMessage).toContain("notified via fallback");
    expect(timelineArg.data.statusMessage).not.toContain(
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
   * GAP A CLOSED - alerts take the same route as incidents. The rule type
   * handed to the fallback is the ALERT one, so whatever the fallback decides is
   * decided against the right cell.
   */
  test("an ALERT on a severity added after the fact is rescued the same way", async () => {
    stubAlert(ALERT_SEV_C);

    await driveOnCreateSuccess(alertOnCallLog());

    expect(executeRuleSpy).not.toHaveBeenCalled();
    expect(fallbackSpy).toHaveBeenCalledTimes(1);
    expect(
      (fallbackSpy.mock.calls[0]![0] as Record<string, unknown>)["ruleType"],
    ).toBe(NotificationRuleType.ON_CALL_EXECUTED_ALERT);

    const updates: Array<{
      status: UserNotificationExecutionStatus;
      statusMessage?: string | undefined;
    }> = statusUpdates();
    expect(updates[1]!.status).toBe(UserNotificationExecutionStatus.Executing);
    expect(updates[1]!.statusMessage).toContain("notified via fallback");
  });

  /*
   * GAP A CLOSED - and the other side of it. A responder with no verified
   * method at all cannot be rescued by anything, and that is the one case that
   * must still end as a loud, terminal Error naming what to do about it.
   */
  test("a responder with no verified method still ends as an explicit Error", async () => {
    stubIncident(SEV_C);
    fallbackSpy.mockResolvedValue({
      notified: false,
      outcome: FallbackNotificationOutcome.NoUsableNotificationMethod,
      channelsUsed: [],
    } as never);

    await driveOnCreateSuccess(incidentOnCallLog());

    const updates: Array<{
      status: UserNotificationExecutionStatus;
      statusMessage?: string | undefined;
    }> = statusUpdates();

    expect(updates[1]!.status).toBe(UserNotificationExecutionStatus.Error);
    expect(updates[1]!.statusMessage).toContain(
      "has no verified notification method",
    );
    expect(updates[1]!.statusMessage).toContain(
      "User Settings > Notification Methods",
    );
  });

  test("an alert on a severity that existed at join time still pages", async () => {
    stubAlert(ALERT_SEV_A);

    await driveOnCreateSuccess(alertOnCallLog());

    expect(executeRuleSpy).toHaveBeenCalledTimes(1);
  });

  /*
   * The two Phase 1 halves are independent, and this is the proof: with the row
   * present the responder is paged through their OWN configured rule and the
   * fallback is never consulted at all. The backfill is what restores the
   * responder's intent; the fallback is only the safety net under it.
   */
  test("backfilling the missing row is sufficient: the very same C-severity incident pages through the real rule", async () => {
    stubIncident(SEV_C);

    // Re-running the defaults against a project that now has C is the backfill.
    stubSeverities([SEV_A, SEV_B, SEV_C], [ALERT_SEV_A, ALERT_SEV_B]);
    await runDefaults();

    await driveOnCreateSuccess(incidentOnCallLog());

    expect(executeRuleSpy).toHaveBeenCalledTimes(1);
    expect(fallbackSpy).not.toHaveBeenCalled();

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
