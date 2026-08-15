import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import UserEmailService from "../../../Server/Services/UserEmailService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import logger from "../../../Server/Utils/Logger";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";
import { EVERY_FIVE_MINUTE } from "../../../Utils/CronTime";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * GAP A, the worker half.
 *
 * A severity created after a responder joined was a severity that responder had
 * no notification rule for. Default rules are written exactly twice in a
 * responder's life - when they join a project and when they verify a
 * notification method - and both paths iterate the severities that exist AT
 * THAT MOMENT. Nothing revisited the question, so the "Sev4" somebody adds a
 * year in paged precisely nobody: every incident on it counted zero matching
 * rules and dropped into an execution log no one reads.
 *
 * Phase 1 closed that with a worker job,
 * App/FeatureSet/Workers/Jobs/OnCallDutyPolicy/BackfillNotificationRulesForNewSeverities.ts,
 * enqueued by name from IncidentSeverityService.onCreateSuccess and
 * AlertSeverityService.onCreateSuccess and also swept on a five-minute
 * schedule over severities created in the last hour.
 *
 * The neighbouring SeverityCreationRuleBackfill.test.ts covers the ENQUEUE:
 * that creating a severity puts the job on the Worker queue and writes nothing
 * inline. This file covers THE JOB ITSELF, through the three functions it
 * exports for exactly this purpose - findRecentlyCreatedSeverities,
 * buildResponderIntents and backfillSeverity - rather than through RunCron.
 *
 * Four properties are load-bearing, and everything here serves one of them:
 *
 *   1. IT MIRRORS INTENT, IT DOES NOT IMPOSE A DEFAULT. Someone who set
 *      "Sev1 -> call me immediately, Sev3 -> email me after fifteen minutes"
 *      gets one new rule per distinct (method, delay) pair they already chose
 *      for that rule type. Not a hardcoded email-at-zero, which would page
 *      instantly a responder who deliberately built a delay into every rule
 *      they own; and above all not a phone call for someone who has only ever
 *      used email. Mirroring can only ever hand a responder a channel they
 *      already opted into. A responder who muted the rule type entirely gets
 *      the mute mirrored, not a page.
 *
 *   2. IT IS IDEMPOTENT. The job runs from two routes at once - the by-name
 *      enqueue fires seconds after a severity is created, and a scheduled sweep
 *      may already be part-way through the same severity - and
 *      UserNotificationRule carries no unique index over
 *      (project, user, ruleType, severity, method). A duplicated rule is a
 *      duplicated page. Two guards are pinned separately below: the per-run
 *      snapshot, and the per-row read taken immediately before each write that
 *      catches the case where the snapshot was already stale.
 *
 *   3. IT DOES NOT LOAD A PROJECT PER RESPONDER. Reads are one project-wide
 *      findAllBy per rule type - which pages in LIMIT_MAX batches under the
 *      hood - not one query per responder. A thousand-responder project must
 *      not issue a thousand queries per severity.
 *
 *   4. ONE RESPONDER'S FAILURE DOES NOT TAKE THE REST DOWN. A method row that
 *      vanishes mid-run is a log line, not an aborted backfill for everybody
 *      else in the project.
 *
 * No database is touched. UserNotificationRule is backed by an in-memory table
 * so that rows written by one run are genuinely visible to the next - the
 * idempotence assertions are only worth anything if the reader really reads
 * what the writer really wrote.
 */

/*
 * The job registers itself with RunCron at import time, which would otherwise
 * reach for the Worker queue (and therefore Redis) as a side effect of
 * importing this file. Mocked before the job module is imported, both to keep
 * the import inert and to capture the registration itself.
 */
jest.mock("../../../../App/FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

// Imported AFTER the mock above so the registration lands in it.
import RunCron from "../../../../App/FeatureSet/Workers/Utils/Cron";
import {
  JOB_NAME,
  backfillSeverity,
  buildResponderIntents,
  findRecentlyCreatedSeverities,
  MirroredRule,
  NewSeverity,
  ResponderIntent,
} from "../../../../App/FeatureSet/Workers/Jobs/OnCallDutyPolicy/BackfillNotificationRulesForNewSeverities";

/*
 * The third copy of the job name. IncidentSeverityService and
 * AlertSeverityService each duplicate this string deliberately (Common cannot
 * import from App), and SeverityCreationRuleBackfill.test.ts pins their copies.
 * This is the job's own, so a rename that misses any of the three surfaces.
 */
const EXPECTED_JOB_NAME: string =
  "OnCallDutyPolicy:BackfillNotificationRulesForNewSeverities";

const PROJECT_ID: ObjectID = new ObjectID("project-1");

const USER_A: ObjectID = new ObjectID("user-a");
const USER_B: ObjectID = new ObjectID("user-b");
const USER_C: ObjectID = new ObjectID("user-c");

const EMAIL_A: ObjectID = new ObjectID("user-email-a");
const EMAIL_A_SECOND: ObjectID = new ObjectID("user-email-a-second");
const EMAIL_B: ObjectID = new ObjectID("user-email-b");
const EMAIL_C: ObjectID = new ObjectID("user-email-c");

const CALL_A: ObjectID = new ObjectID("user-call-a");
const SMS_A: ObjectID = new ObjectID("user-sms-a");
const PUSH_A: ObjectID = new ObjectID("user-push-a");

// The severities that existed when the responder configured their rules...
const SEV_1: ObjectID = new ObjectID("incident-severity-1");
const SEV_2: ObjectID = new ObjectID("incident-severity-2");
const SEV_3: ObjectID = new ObjectID("incident-severity-3");
// ...and the one added a year later, which nothing covered.
const SEV_NEW: ObjectID = new ObjectID("incident-severity-4-added-later");

const ALERT_SEV_1: ObjectID = new ObjectID("alert-severity-1");
const ALERT_SEV_NEW: ObjectID = new ObjectID("alert-severity-4-added-later");

const INCIDENT_RULE_TYPES: Array<NotificationRuleType> = [
  NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
  NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
];

const ALERT_RULE_TYPES: Array<NotificationRuleType> = [
  NotificationRuleType.ON_CALL_EXECUTED_ALERT,
  NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
];

type RuleMethodColumn =
  | "userEmailId"
  | "userSmsId"
  | "userCallId"
  | "userPushId"
  | "userWhatsAppId"
  | "userTelegramId"
  | "userWebhookId";

type RuleIdColumn =
  | RuleMethodColumn
  | "projectId"
  | "userId"
  | "incidentSeverityId"
  | "alertSeverityId";

const METHOD_COLUMNS: Array<RuleMethodColumn> = [
  "userEmailId",
  "userSmsId",
  "userCallId",
  "userPushId",
  "userWhatsAppId",
  "userTelegramId",
  "userWebhookId",
];

const ID_COLUMNS: Array<RuleIdColumn> = [
  "projectId",
  "userId",
  "incidentSeverityId",
  "alertSeverityId",
  ...METHOD_COLUMNS,
];

/*
 * ------------------------------------------------------------------------- *
 * An in-memory stand-in for the UserNotificationRule table.
 *
 * Rows are real model instances, because that is what the job reads: it asks
 * rules for `.userId`, `.isOptOut`, `.notifyAfterMinutes` and the seven method
 * foreign keys, and hands `create` a model it built itself.
 * -------------------------------------------------------------------------
 */

let ruleStore: Array<UserNotificationRule> = [];

// Only the rows THIS run wrote - the whole point of the idempotence assertions.
let createdRules: Array<UserNotificationRule> = [];

/*
 * When set, findAllBy reports this instead of the live table.
 *
 * That is how an OVERLAPPING run is expressed: the job's per-rule-type snapshot
 * is taken once at the top of a run, so a second run that started before the
 * first one wrote anything is a run whose snapshot no longer matches the table.
 * findOneBy always reads the live table, which is precisely the guard under
 * test.
 */
let frozenSnapshot: Array<UserNotificationRule> | null = null;

// The verified email rows the project has, in the order the query returns them.
let verifiedEmails: Array<{ userId: ObjectID; emailId: ObjectID }> = [];

let ruleFindAllBySpy: jest.SpyInstance;
let ruleFindOneBySpy: jest.SpyInstance;
let ruleCreateSpy: jest.SpyInstance;
let userEmailFindAllBySpy: jest.SpyInstance;
let loggerErrorSpy: jest.SpyInstance;

function idOf(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return String(value);
}

interface RuleSpec {
  userId: ObjectID;
  ruleType: NotificationRuleType;
  projectId?: ObjectID | undefined;
  incidentSeverityId?: ObjectID | undefined;
  alertSeverityId?: ObjectID | undefined;
  notifyAfterMinutes?: number | undefined;
  userEmailId?: ObjectID | undefined;
  userSmsId?: ObjectID | undefined;
  userCallId?: ObjectID | undefined;
  userPushId?: ObjectID | undefined;
  isOptOut?: boolean | undefined;
}

let seedCounter: number = 0;

/*
 * A rule row as the responder (or an earlier default-rule pass) left it.
 * Columns are only set when the spec names them, so "no severity id at all" and
 * "no delay at all" - both of which really occur in this table - stay
 * expressible.
 */
function makeRule(spec: RuleSpec): UserNotificationRule {
  seedCounter++;

  const rule: UserNotificationRule = new UserNotificationRule();
  rule._id = `seeded-rule-${seedCounter}`;
  rule.projectId = spec.projectId || PROJECT_ID;
  rule.userId = spec.userId;
  rule.ruleType = spec.ruleType;

  if (spec.incidentSeverityId) {
    rule.incidentSeverityId = spec.incidentSeverityId;
  }

  if (spec.alertSeverityId) {
    rule.alertSeverityId = spec.alertSeverityId;
  }

  if (spec.notifyAfterMinutes !== undefined) {
    rule.notifyAfterMinutes = spec.notifyAfterMinutes;
  }

  if (spec.userEmailId) {
    rule.userEmailId = spec.userEmailId;
  }

  if (spec.userSmsId) {
    rule.userSmsId = spec.userSmsId;
  }

  if (spec.userCallId) {
    rule.userCallId = spec.userCallId;
  }

  if (spec.userPushId) {
    rule.userPushId = spec.userPushId;
  }

  if (spec.isOptOut !== undefined) {
    rule.isOptOut = spec.isOptOut;
  }

  return rule;
}

function seedRule(spec: RuleSpec): UserNotificationRule {
  const rule: UserNotificationRule = makeRule(spec);
  ruleStore.push(rule);

  return rule;
}

/*
 * Match a stored row against a service query. A column the query does not carry
 * is not a constraint, which mirrors how the real queries are built: the
 * per-rule-type read names only projectId and ruleType, and the pre-write
 * existence check names exactly one method column.
 */
function ruleMatchesQuery(
  rule: UserNotificationRule,
  query: Record<string, unknown>,
): boolean {
  for (const column of ID_COLUMNS) {
    const expected: string | undefined = idOf(query[column]);

    if (expected !== undefined && idOf(rule[column]) !== expected) {
      return false;
    }
  }

  const expectedRuleType: unknown = query["ruleType"];

  if (expectedRuleType !== undefined && rule.ruleType !== expectedRuleType) {
    return false;
  }

  const expectedDelay: unknown = query["notifyAfterMinutes"];

  if (
    expectedDelay !== undefined &&
    rule.notifyAfterMinutes !== expectedDelay
  ) {
    return false;
  }

  /*
   * Compared as a boolean because an ordinary rule leaves the column undefined
   * rather than false, while the opt-out existence check asks for `true`.
   */
  const expectedOptOut: unknown = query["isOptOut"];

  if (
    expectedOptOut !== undefined &&
    Boolean(rule.isOptOut) !== expectedOptOut
  ) {
    return false;
  }

  return true;
}

function matchingRules(
  source: Array<UserNotificationRule>,
  query: Record<string, unknown>,
): Array<UserNotificationRule> {
  return source.filter((rule: UserNotificationRule): boolean => {
    return ruleMatchesQuery(rule, query);
  });
}

/* "userCallId:user-call-a", or "none" for an opt-out row. */
function methodOf(rule: UserNotificationRule): string {
  for (const column of METHOD_COLUMNS) {
    const value: ObjectID | undefined = rule[column];

    if (value) {
      return `${column}:${value.toString()}`;
    }
  }

  return "none";
}

/* The whole of what a rule says, in one comparable string: "how@when". */
function shapeOf(rule: UserNotificationRule): string {
  return `${methodOf(rule)}@${String(rule.notifyAfterMinutes)}`;
}

function createdOfType(
  ruleType: NotificationRuleType,
): Array<UserNotificationRule> {
  return createdRules.filter((rule: UserNotificationRule): boolean => {
    return rule.ruleType === ruleType;
  });
}

function shapesCreatedFor(ruleType: NotificationRuleType): Array<string> {
  return createdOfType(ruleType).map((rule: UserNotificationRule): string => {
    return shapeOf(rule);
  });
}

function incidentSeverity(id: ObjectID): NewSeverity {
  return {
    id: id,
    projectId: PROJECT_ID,
    kind: "incident",
  };
}

function alertSeverity(id: ObjectID): NewSeverity {
  return {
    id: id,
    projectId: PROJECT_ID,
    kind: "alert",
  };
}

function incidentSeverityRow(
  id: ObjectID | null,
  projectId: ObjectID | null,
): IncidentSeverity {
  const severity: IncidentSeverity = new IncidentSeverity();

  if (id) {
    severity._id = id.toString();
  }

  if (projectId) {
    severity.projectId = projectId;
  }

  return severity;
}

function alertSeverityRow(
  id: ObjectID | null,
  projectId: ObjectID | null,
): AlertSeverity {
  const severity: AlertSeverity = new AlertSeverity();

  if (id) {
    severity._id = id.toString();
  }

  if (projectId) {
    severity.projectId = projectId;
  }

  return severity;
}

function userEmailRow(userId: ObjectID, emailId: ObjectID): UserEmail {
  const model: UserEmail = new UserEmail();
  model._id = emailId.toString();
  model.userId = userId;

  return model;
}

function queryOf(
  spy: jest.SpyInstance,
  callIndex: number,
): Record<string, unknown> {
  return (spy.mock.calls[callIndex]![0] as { query: Record<string, unknown> })
    .query;
}

function propsOf(
  spy: jest.SpyInstance,
  callIndex: number,
): { isRoot?: boolean | undefined } {
  return (
    spy.mock.calls[callIndex]![0] as {
      props: { isRoot?: boolean | undefined };
    }
  ).props;
}

beforeEach(() => {
  ruleStore = [];
  createdRules = [];
  frozenSnapshot = null;
  verifiedEmails = [];
  seedCounter = 0;

  ruleFindAllBySpy = jest
    .spyOn(UserNotificationRuleService, "findAllBy")
    .mockImplementation(((data: {
      query: Record<string, unknown>;
    }): Promise<Array<UserNotificationRule>> => {
      return Promise.resolve(
        matchingRules(frozenSnapshot || ruleStore, data.query),
      );
    }) as never);

  ruleFindOneBySpy = jest
    .spyOn(UserNotificationRuleService, "findOneBy")
    .mockImplementation(((data: {
      query: Record<string, unknown>;
    }): Promise<UserNotificationRule | null> => {
      return Promise.resolve(matchingRules(ruleStore, data.query)[0] || null);
    }) as never);

  ruleCreateSpy = jest
    .spyOn(UserNotificationRuleService, "create")
    .mockImplementation(((data: {
      data: UserNotificationRule;
    }): Promise<UserNotificationRule> => {
      const rule: UserNotificationRule = data.data;
      rule._id = `created-rule-${createdRules.length + 1}`;

      ruleStore.push(rule);
      createdRules.push(rule);

      return Promise.resolve(rule);
    }) as never);

  userEmailFindAllBySpy = jest
    .spyOn(UserEmailService, "findAllBy")
    .mockImplementation(((): Promise<Array<UserEmail>> => {
      return Promise.resolve(
        verifiedEmails.map(
          (entry: { userId: ObjectID; emailId: ObjectID }): UserEmail => {
            return userEmailRow(entry.userId, entry.emailId);
          },
        ),
      );
    }) as never);

  // The job logs a failed row rather than throwing; keep the output clean.
  loggerErrorSpy = jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * ========================================================================= *
 * The registration itself.
 * =========================================================================
 */

describe("the sweep is registered under the name both severity services enqueue", () => {
  test("the job name is the exact string IncidentSeverityService and AlertSeverityService duplicate", () => {
    expect(JOB_NAME).toBe(EXPECTED_JOB_NAME);
  });

  /*
   * The by-name enqueue is best-effort: if Redis is unreachable when a severity
   * is created, the enqueue is swallowed and coverage depends entirely on this
   * schedule existing. runOnStartup stays false because a worker restart loop
   * must not re-run the sweep on every boot.
   */
  test("it registers a five-minute schedule that does not run on startup", () => {
    const runCronMock: jest.Mock = RunCron as unknown as jest.Mock;

    expect(runCronMock).toHaveBeenCalledTimes(1);

    const call: Array<unknown> = runCronMock.mock.calls[0]!;
    expect(call[0]).toBe(EXPECTED_JOB_NAME);

    const options: { schedule: string; runOnStartup: boolean } = call[1] as {
      schedule: string;
      runOnStartup: boolean;
    };

    expect(options.schedule).toBe(EVERY_FIVE_MINUTE);
    expect(options.runOnStartup).toBe(false);
  });
});

/*
 * ========================================================================= *
 * findRecentlyCreatedSeverities - the sweep re-derives its own work set.
 *
 * The Worker queue dispatches on job NAME and hands the job function no
 * payload, so the job cannot be told which severity to cover; it has to ask.
 * Asking over a window wider than the schedule is what makes a lost enqueue
 * cost minutes of latency instead of a permanently uncovered severity.
 * =========================================================================
 */

describe("findRecentlyCreatedSeverities", () => {
  let incidentFindAllBySpy: jest.SpyInstance;
  let alertFindAllBySpy: jest.SpyInstance;

  function stubSeverityTables(
    incidentRows: Array<IncidentSeverity>,
    alertRows: Array<AlertSeverity>,
  ): void {
    incidentFindAllBySpy = jest
      .spyOn(IncidentSeverityService, "findAllBy")
      .mockResolvedValue(incidentRows as never);
    alertFindAllBySpy = jest
      .spyOn(AlertSeverityService, "findAllBy")
      .mockResolvedValue(alertRows as never);
  }

  /*
   * QueryHelper.greaterThanEqualTo builds a TypeORM Raw operator carrying its
   * bound as a bound parameter. Reading it back is the only way to assert the
   * window is a window at all rather than "every severity ever created".
   */
  function lookbackInMinutes(query: Record<string, unknown>): number {
    const operator: { objectLiteralParameters?: Record<string, unknown> } =
      query["createdAt"] as unknown as {
        objectLiteralParameters?: Record<string, unknown>;
      };

    const parameters: Record<string, unknown> =
      operator.objectLiteralParameters || {};
    const values: Array<unknown> = Object.values(parameters);

    expect(values).toHaveLength(1);

    const bound: Date = values[0] as Date;

    return (Date.now() - bound.getTime()) / (60 * 1000);
  }

  test("it reads both severity tables, root-privileged, selecting only what it needs", async () => {
    stubSeverityTables([], []);

    await findRecentlyCreatedSeverities();

    expect(incidentFindAllBySpy).toHaveBeenCalledTimes(1);
    expect(alertFindAllBySpy).toHaveBeenCalledTimes(1);

    expect(propsOf(incidentFindAllBySpy, 0).isRoot).toBe(true);
    expect(propsOf(alertFindAllBySpy, 0).isRoot).toBe(true);

    const select: Record<string, unknown> = (
      incidentFindAllBySpy.mock.calls[0]![0] as {
        select: Record<string, unknown>;
      }
    ).select;

    expect(select["_id"]).toBe(true);
    expect(select["projectId"]).toBe(true);
  });

  test("the window is an hour wide - comfortably longer than the five-minute schedule", async () => {
    stubSeverityTables([], []);

    await findRecentlyCreatedSeverities();

    expect(lookbackInMinutes(queryOf(incidentFindAllBySpy, 0))).toBeGreaterThan(
      59,
    );
    expect(lookbackInMinutes(queryOf(incidentFindAllBySpy, 0))).toBeLessThan(
      61,
    );
    expect(lookbackInMinutes(queryOf(alertFindAllBySpy, 0))).toBeGreaterThan(
      59,
    );
    expect(lookbackInMinutes(queryOf(alertFindAllBySpy, 0))).toBeLessThan(61);
  });

  test("a quiet project yields no work at all - severity creation is rare", async () => {
    stubSeverityTables([], []);

    await expect(findRecentlyCreatedSeverities()).resolves.toEqual([]);
  });

  /*
   * The kind tag is what tells backfillSeverity which of the two severity
   * columns to write and which pair of rule types to cover, so a row from the
   * wrong table would silently write a rule that can never match.
   */
  test("each severity is tagged with the table it came from", async () => {
    stubSeverityTables(
      [incidentSeverityRow(SEV_NEW, PROJECT_ID)],
      [alertSeverityRow(ALERT_SEV_NEW, PROJECT_ID)],
    );

    const severities: Array<NewSeverity> =
      await findRecentlyCreatedSeverities();

    expect(severities).toHaveLength(2);

    const incident: NewSeverity | undefined = severities.find(
      (severity: NewSeverity): boolean => {
        return severity.kind === "incident";
      },
    );
    const alert: NewSeverity | undefined = severities.find(
      (severity: NewSeverity): boolean => {
        return severity.kind === "alert";
      },
    );

    expect(incident!.id.toString()).toBe(SEV_NEW.toString());
    expect(incident!.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(alert!.id.toString()).toBe(ALERT_SEV_NEW.toString());
    expect(alert!.projectId.toString()).toBe(PROJECT_ID.toString());
  });

  test("a row with no id or no project is skipped rather than backfilled against nothing", async () => {
    stubSeverityTables(
      [
        incidentSeverityRow(null, PROJECT_ID),
        incidentSeverityRow(SEV_NEW, null),
        incidentSeverityRow(SEV_1, PROJECT_ID),
      ],
      [alertSeverityRow(null, null)],
    );

    const severities: Array<NewSeverity> =
      await findRecentlyCreatedSeverities();

    expect(severities).toHaveLength(1);
    expect(severities[0]!.id.toString()).toBe(SEV_1.toString());
  });
});

/*
 * ========================================================================= *
 * buildResponderIntents - "what would this person want for a new severity?"
 *
 * The answer is: the same channels, at the same delays, that they already chose
 * for this rule type on the severities they did configure.
 * =========================================================================
 */

describe("buildResponderIntents", () => {
  function intentsFor(
    rules: Array<UserNotificationRule>,
    severity: NewSeverity,
  ): Map<string, ResponderIntent> {
    return buildResponderIntents(rules, severity);
  }

  function mirroredOf(intent: ResponderIntent): Array<string> {
    return Array.from(intent.mirroredRules.values()).map(
      (mirrored: MirroredRule): string => {
        return `${mirrored.methodColumn}:${mirrored.methodId.toString()}@${String(
          mirrored.notifyAfterMinutes,
        )}`;
      },
    );
  }

  test("the same (method, delay) used on three severities is one distinct pair", () => {
    const intents: Map<string, ResponderIntent> = intentsFor(
      [
        makeRule({
          userId: USER_A,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: SEV_1,
          userEmailId: EMAIL_A,
          notifyAfterMinutes: 0,
        }),
        makeRule({
          userId: USER_A,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: SEV_2,
          userEmailId: EMAIL_A,
          notifyAfterMinutes: 0,
        }),
        makeRule({
          userId: USER_A,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: SEV_3,
          userEmailId: EMAIL_A,
          notifyAfterMinutes: 0,
        }),
      ],
      incidentSeverity(SEV_NEW),
    );

    expect(mirroredOf(intents.get(USER_A.toString())!)).toEqual([
      `userEmailId:${EMAIL_A.toString()}@0`,
    ]);
  });

  /*
   * The delay is part of the key on purpose. "Email me now" and "email me in
   * fifteen minutes" are two different requests, and a key that ignored the
   * delay would collapse them into one.
   */
  test("the same method at two delays is two distinct pairs", () => {
    const intents: Map<string, ResponderIntent> = intentsFor(
      [
        makeRule({
          userId: USER_A,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: SEV_1,
          userEmailId: EMAIL_A,
          notifyAfterMinutes: 0,
        }),
        makeRule({
          userId: USER_A,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: SEV_1,
          userEmailId: EMAIL_A,
          notifyAfterMinutes: 15,
        }),
      ],
      incidentSeverity(SEV_NEW),
    );

    expect(mirroredOf(intents.get(USER_A.toString())!).sort()).toEqual([
      `userEmailId:${EMAIL_A.toString()}@0`,
      `userEmailId:${EMAIL_A.toString()}@15`,
    ]);
  });

  test("two different channels at the same delay do not collide", () => {
    const intents: Map<string, ResponderIntent> = intentsFor(
      [
        makeRule({
          userId: USER_A,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: SEV_1,
          userEmailId: EMAIL_A,
          notifyAfterMinutes: 0,
        }),
        makeRule({
          userId: USER_A,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: SEV_1,
          userCallId: CALL_A,
          notifyAfterMinutes: 0,
        }),
      ],
      incidentSeverity(SEV_NEW),
    );

    expect(mirroredOf(intents.get(USER_A.toString())!)).toHaveLength(2);
  });

  test("responders are kept apart - one person's channels never leak into another's", () => {
    const intents: Map<string, ResponderIntent> = intentsFor(
      [
        makeRule({
          userId: USER_A,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: SEV_1,
          userCallId: CALL_A,
          notifyAfterMinutes: 0,
        }),
        makeRule({
          userId: USER_B,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: SEV_1,
          userEmailId: EMAIL_B,
          notifyAfterMinutes: 30,
        }),
      ],
      incidentSeverity(SEV_NEW),
    );

    expect(intents.size).toBe(2);
    expect(mirroredOf(intents.get(USER_A.toString())!)).toEqual([
      `userCallId:${CALL_A.toString()}@0`,
    ]);
    expect(mirroredOf(intents.get(USER_B.toString())!)).toEqual([
      `userEmailId:${EMAIL_B.toString()}@30`,
    ]);
  });

  /*
   * A row for the new severity is the idempotency guard, not input: it means an
   * earlier run - or the responder - already covered this cell, and mirroring
   * it back onto itself would be the duplicate the whole design exists to
   * avoid.
   */
  test("a row for the new severity marks the cell covered and is not itself mirrored", () => {
    const intents: Map<string, ResponderIntent> = intentsFor(
      [
        makeRule({
          userId: USER_A,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: SEV_NEW,
          userEmailId: EMAIL_A,
          notifyAfterMinutes: 0,
        }),
      ],
      incidentSeverity(SEV_NEW),
    );

    const intent: ResponderIntent = intents.get(USER_A.toString())!;

    expect(intent.hasRuleForNewSeverity).toBe(true);
    expect(mirroredOf(intent)).toEqual([]);
  });

  test("an opt-out row is recorded as an opt-out and contributes no channel", () => {
    const intents: Map<string, ResponderIntent> = intentsFor(
      [
        makeRule({
          userId: USER_A,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: SEV_1,
          isOptOut: true,
          notifyAfterMinutes: 0,
        }),
      ],
      incidentSeverity(SEV_NEW),
    );

    const intent: ResponderIntent = intents.get(USER_A.toString())!;

    expect(intent.hasOptOut).toBe(true);
    expect(intent.hasRuleForNewSeverity).toBe(false);
    expect(mirroredOf(intent)).toEqual([]);
  });

  /*
   * Episode default rules were written without a severity id for a long time
   * (Gap G). Those rows are just as much a statement of "this is how I want to
   * be told" as a severity-scoped one.
   */
  test("a row with no severity at all still counts as intent", () => {
    const intents: Map<string, ResponderIntent> = intentsFor(
      [
        makeRule({
          userId: USER_A,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
          userSmsId: SMS_A,
          notifyAfterMinutes: 5,
        }),
      ],
      incidentSeverity(SEV_NEW),
    );

    const intent: ResponderIntent = intents.get(USER_A.toString())!;

    expect(intent.hasRuleForNewSeverity).toBe(false);
    expect(mirroredOf(intent)).toEqual([`userSmsId:${SMS_A.toString()}@5`]);
  });

  test("a missing delay is read as immediate, not as undefined", () => {
    const intents: Map<string, ResponderIntent> = intentsFor(
      [
        makeRule({
          userId: USER_A,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: SEV_1,
          userEmailId: EMAIL_A,
        }),
      ],
      incidentSeverity(SEV_NEW),
    );

    const mirrored: Array<MirroredRule> = Array.from(
      intents.get(USER_A.toString())!.mirroredRules.values(),
    );

    expect(mirrored[0]!.notifyAfterMinutes).toBe(0);
  });

  test("a row with no user is ignored entirely", () => {
    const orphan: UserNotificationRule = new UserNotificationRule();
    orphan._id = "orphan-rule";
    orphan.ruleType = NotificationRuleType.ON_CALL_EXECUTED_INCIDENT;
    orphan.userEmailId = EMAIL_A;

    expect(intentsFor([orphan], incidentSeverity(SEV_NEW)).size).toBe(0);
  });

  /*
   * The two severity columns are read according to the KIND being backfilled.
   * A rule carrying an incidentSeverityId cannot mark an alert severity
   * covered, however equal the ids happen to look.
   */
  test("an alert backfill reads alertSeverityId, never incidentSeverityId", () => {
    const intents: Map<string, ResponderIntent> = intentsFor(
      [
        makeRule({
          userId: USER_A,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
          incidentSeverityId: ALERT_SEV_NEW,
          userEmailId: EMAIL_A,
          notifyAfterMinutes: 0,
        }),
      ],
      alertSeverity(ALERT_SEV_NEW),
    );

    const intent: ResponderIntent = intents.get(USER_A.toString())!;

    expect(intent.hasRuleForNewSeverity).toBe(false);
    expect(mirroredOf(intent)).toEqual([`userEmailId:${EMAIL_A.toString()}@0`]);
  });
});

/*
 * ========================================================================= *
 * backfillSeverity - mirroring existing intent.
 *
 * Note throughout: one severity covers TWO rule types (incident and incident
 * episode, or alert and alert episode), so a responder configured only for the
 * non-episode type is mirrored there and falls back to their verified email for
 * the episode one. The assertions are per rule type for exactly that reason.
 * =========================================================================
 */

describe("backfillSeverity mirrors what the responder already asked for", () => {
  /*
   * The headline case. "Sev1 -> call me at once, Sev3 -> email me after fifteen
   * minutes" must become one new rule per pair - not a surprise phone call at a
   * delay they never chose, and not a flattened email-at-zero default.
   */
  test("a responder with two different (method, delay) pairs gets both of them", async () => {
    verifiedEmails = [{ userId: USER_A, emailId: EMAIL_A }];

    seedRule({
      userId: USER_A,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      incidentSeverityId: SEV_1,
      userCallId: CALL_A,
      notifyAfterMinutes: 0,
    });
    seedRule({
      userId: USER_A,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      incidentSeverityId: SEV_3,
      userEmailId: EMAIL_A,
      notifyAfterMinutes: 15,
    });

    await backfillSeverity(incidentSeverity(SEV_NEW));

    const shapes: Array<string> = shapesCreatedFor(
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    );

    expect(shapes).toHaveLength(2);
    expect(shapes).toContain(`userCallId:${CALL_A.toString()}@0`);
    expect(shapes).toContain(`userEmailId:${EMAIL_A.toString()}@15`);

    // The flattened default they must NOT get: their email, immediately.
    expect(shapes).not.toContain(`userEmailId:${EMAIL_A.toString()}@0`);
  });

  test("every new rule is bound to the new severity and to no other", async () => {
    verifiedEmails = [{ userId: USER_A, emailId: EMAIL_A }];

    seedRule({
      userId: USER_A,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      incidentSeverityId: SEV_1,
      userCallId: CALL_A,
      notifyAfterMinutes: 0,
    });

    await backfillSeverity(incidentSeverity(SEV_NEW));

    expect(createdRules.length).toBeGreaterThan(0);

    for (const rule of createdRules) {
      expect(rule.projectId!.toString()).toBe(PROJECT_ID.toString());
      expect(rule.userId!.toString()).toBe(USER_A.toString());
      expect(rule.incidentSeverityId!.toString()).toBe(SEV_NEW.toString());
      expect(rule.alertSeverityId).toBeUndefined();
    }
  });

  /*
   * The failure mode a hardcoded default would produce: a responder who has
   * only ever used email waking up to a phone call.
   */
  test("an email-only responder is never given a phone call", async () => {
    verifiedEmails = [{ userId: USER_A, emailId: EMAIL_A }];

    seedRule({
      userId: USER_A,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      incidentSeverityId: SEV_1,
      userEmailId: EMAIL_A,
      notifyAfterMinutes: 10,
    });

    await backfillSeverity(incidentSeverity(SEV_NEW));

    for (const rule of createdOfType(
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    )) {
      expect(rule.userCallId).toBeUndefined();
      expect(rule.userSmsId).toBeUndefined();
      expect(rule.notifyAfterMinutes).toBe(10);
    }
  });

  test("the same pair repeated across severities produces exactly one new rule", async () => {
    verifiedEmails = [{ userId: USER_A, emailId: EMAIL_A }];

    for (const severityId of [SEV_1, SEV_2, SEV_3]) {
      seedRule({
        userId: USER_A,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        incidentSeverityId: severityId,
        userPushId: PUSH_A,
        notifyAfterMinutes: 0,
      });
    }

    await backfillSeverity(incidentSeverity(SEV_NEW));

    expect(
      shapesCreatedFor(NotificationRuleType.ON_CALL_EXECUTED_INCIDENT),
    ).toEqual([`userPushId:${PUSH_A.toString()}@0`]);
  });

  /*
   * A responder who deliberately muted this rule type gets the mute mirrored.
   * Leaving the cell empty would hand them to the verified-method fallback in
   * UserOnCallLogService, which is to say it would page someone who explicitly
   * asked not to be paged.
   */
  test("a responder who opted out is given an opt-out row, not a page", async () => {
    verifiedEmails = [{ userId: USER_A, emailId: EMAIL_A }];

    seedRule({
      userId: USER_A,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      incidentSeverityId: SEV_1,
      isOptOut: true,
      notifyAfterMinutes: 0,
    });

    await backfillSeverity(incidentSeverity(SEV_NEW));

    const created: Array<UserNotificationRule> = createdOfType(
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    );

    expect(created).toHaveLength(1);
    expect(created[0]!.isOptOut).toBe(true);
    expect(methodOf(created[0]!)).toBe("none");
    expect(created[0]!.notifyAfterMinutes).toBe(0);
    expect(created[0]!.incidentSeverityId!.toString()).toBe(SEV_NEW.toString());
  });

  test("an opt-out on one severity does not silence a responder who configured another", async () => {
    verifiedEmails = [{ userId: USER_A, emailId: EMAIL_A }];

    seedRule({
      userId: USER_A,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      incidentSeverityId: SEV_1,
      isOptOut: true,
      notifyAfterMinutes: 0,
    });
    seedRule({
      userId: USER_A,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      incidentSeverityId: SEV_3,
      userEmailId: EMAIL_A,
      notifyAfterMinutes: 0,
    });

    await backfillSeverity(incidentSeverity(SEV_NEW));

    const created: Array<UserNotificationRule> = createdOfType(
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    );

    expect(created).toHaveLength(1);
    expect(created[0]!.isOptOut).toBeUndefined();
    expect(methodOf(created[0]!)).toBe(`userEmailId:${EMAIL_A.toString()}`);
  });

  /*
   * Mirroring is per rule type. An incident-only responder's phone-call rule
   * must not become an alert rule, and vice versa - the two lists are
   * configured independently in the UI and mean different things.
   */
  test("an alert backfill ignores the responder's incident rules", async () => {
    verifiedEmails = [{ userId: USER_A, emailId: EMAIL_A }];

    seedRule({
      userId: USER_A,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      incidentSeverityId: SEV_1,
      userCallId: CALL_A,
      notifyAfterMinutes: 0,
    });

    await backfillSeverity(alertSeverity(ALERT_SEV_NEW));

    const shapes: Array<string> = shapesCreatedFor(
      NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    );

    expect(shapes).toEqual([`userEmailId:${EMAIL_A.toString()}@0`]);
    expect(shapes).not.toContain(`userCallId:${CALL_A.toString()}@0`);
  });

  test("both rule types of a severity kind are covered, and only those two", async () => {
    verifiedEmails = [{ userId: USER_A, emailId: EMAIL_A }];

    await backfillSeverity(incidentSeverity(SEV_NEW));

    const typesCovered: Array<NotificationRuleType | undefined> =
      createdRules.map(
        (rule: UserNotificationRule): NotificationRuleType | undefined => {
          return rule.ruleType;
        },
      );

    expect(typesCovered.sort()).toEqual([...INCIDENT_RULE_TYPES].sort());
  });

  test("an episode rule written without a severity is mirrored onto the new severity", async () => {
    verifiedEmails = [{ userId: USER_A, emailId: EMAIL_A }];

    seedRule({
      userId: USER_A,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
      userSmsId: SMS_A,
      notifyAfterMinutes: 5,
    });

    await backfillSeverity(incidentSeverity(SEV_NEW));

    // Their stated channel, not the email default they never asked for.
    expect(
      shapesCreatedFor(NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE),
    ).toEqual([`userSmsId:${SMS_A.toString()}@5`]);
  });
});

/*
 * ========================================================================= *
 * backfillSeverity - the verified-email fallback.
 *
 * A responder who has said nothing at all about a rule type gets exactly what
 * addDefaultNotificationRuleForUser would have written for them had the
 * severity existed when they joined.
 * =========================================================================
 */

describe("backfillSeverity falls back to the responder's verified email", () => {
  test("a responder with no rules of that type gets their verified email, immediately", async () => {
    verifiedEmails = [{ userId: USER_A, emailId: EMAIL_A }];

    await backfillSeverity(incidentSeverity(SEV_NEW));

    expect(createdRules).toHaveLength(2);

    for (const ruleType of INCIDENT_RULE_TYPES) {
      expect(shapesCreatedFor(ruleType)).toEqual([
        `userEmailId:${EMAIL_A.toString()}@0`,
      ]);
    }

    for (const rule of createdRules) {
      expect(rule.isOptOut).toBeUndefined();
    }
  });

  /*
   * The read that decides who is reachable at all. Unverified addresses are
   * excluded by the query itself, which is what makes "no verified method =>
   * nothing written" true rather than accidental.
   */
  test("only verified addresses in this project are considered", async () => {
    verifiedEmails = [{ userId: USER_A, emailId: EMAIL_A }];

    await backfillSeverity(incidentSeverity(SEV_NEW));

    const query: Record<string, unknown> = queryOf(userEmailFindAllBySpy, 0);

    expect(idOf(query["projectId"])).toBe(PROJECT_ID.toString());
    expect(query["isVerified"]).toBe(true);
    expect(propsOf(userEmailFindAllBySpy, 0).isRoot).toBe(true);
  });

  test("a responder with no verified method gets nothing, and the run still covers everyone else", async () => {
    // USER_B has no verified email row at all, so the project cannot reach them.
    verifiedEmails = [
      { userId: USER_A, emailId: EMAIL_A },
      { userId: USER_C, emailId: EMAIL_C },
    ];

    await expect(
      backfillSeverity(incidentSeverity(SEV_NEW)),
    ).resolves.toBeUndefined();

    const usersCovered: Array<string> = createdRules.map(
      (rule: UserNotificationRule): string => {
        return rule.userId!.toString();
      },
    );

    expect(usersCovered).not.toContain(USER_B.toString());
    expect(createdRules).toHaveLength(4);
  });

  test("a responder with several verified addresses gets one rule, on the first", async () => {
    verifiedEmails = [
      { userId: USER_A, emailId: EMAIL_A },
      { userId: USER_A, emailId: EMAIL_A_SECOND },
    ];

    await backfillSeverity(incidentSeverity(SEV_NEW));

    expect(createdRules).toHaveLength(2);
    expect(
      shapesCreatedFor(NotificationRuleType.ON_CALL_EXECUTED_INCIDENT),
    ).toEqual([`userEmailId:${EMAIL_A.toString()}@0`]);
  });

  /*
   * The fallback is only for responders who said NOTHING. Someone whose stated
   * channel is SMS keeps SMS even though the email map is what enumerates the
   * project.
   */
  test("a responder who stated a channel keeps it instead of the email default", async () => {
    verifiedEmails = [{ userId: USER_A, emailId: EMAIL_A }];

    seedRule({
      userId: USER_A,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      incidentSeverityId: SEV_1,
      userSmsId: SMS_A,
      notifyAfterMinutes: 0,
    });

    await backfillSeverity(incidentSeverity(SEV_NEW));

    expect(
      shapesCreatedFor(NotificationRuleType.ON_CALL_EXECUTED_INCIDENT),
    ).toEqual([`userSmsId:${SMS_A.toString()}@0`]);
  });
});

/*
 * ========================================================================= *
 * backfillSeverity - idempotence.
 *
 * A duplicated rule is a duplicated page. There is no unique index over
 * (project, user, ruleType, severity, method), so two guards do this work and
 * they are pinned separately: the per-run snapshot, and the per-row read taken
 * immediately before each write.
 * =========================================================================
 */

describe("backfillSeverity is idempotent", () => {
  test("running the same severity a second time writes nothing", async () => {
    verifiedEmails = [{ userId: USER_A, emailId: EMAIL_A }];

    seedRule({
      userId: USER_A,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      incidentSeverityId: SEV_1,
      userCallId: CALL_A,
      notifyAfterMinutes: 0,
    });

    await backfillSeverity(incidentSeverity(SEV_NEW));
    const afterFirstRun: number = createdRules.length;
    expect(afterFirstRun).toBeGreaterThan(0);

    await backfillSeverity(incidentSeverity(SEV_NEW));

    expect(createdRules).toHaveLength(afterFirstRun);
  });

  test("a third and fourth run still write nothing", async () => {
    verifiedEmails = [
      { userId: USER_A, emailId: EMAIL_A },
      { userId: USER_B, emailId: EMAIL_B },
    ];

    await backfillSeverity(incidentSeverity(SEV_NEW));
    const afterFirstRun: number = createdRules.length;

    await backfillSeverity(incidentSeverity(SEV_NEW));
    await backfillSeverity(incidentSeverity(SEV_NEW));
    await backfillSeverity(incidentSeverity(SEV_NEW));

    expect(createdRules).toHaveLength(afterFirstRun);
    expect(createdRules).toHaveLength(4);
  });

  /*
   * The second guard, in isolation. Both runs took their snapshot before either
   * wrote, so the snapshot cannot save the loser - only the read taken
   * immediately before the write can, and it is the one that must fire here.
   * That overlap is likeliest at exactly the worst moment: a new severity
   * arrives by two routes at once, the by-name enqueue seconds after creation
   * and a scheduled sweep already part-way through the same severity.
   */
  test("a row written by an overlapping run between the snapshot and the write is not duplicated", async () => {
    verifiedEmails = [{ userId: USER_A, emailId: EMAIL_A }];

    const existing: UserNotificationRule = seedRule({
      userId: USER_A,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      incidentSeverityId: SEV_1,
      userCallId: CALL_A,
      notifyAfterMinutes: 0,
    });

    // The snapshot BOTH overlapping runs took: nothing for the new severity yet.
    frozenSnapshot = [existing];

    // One run wins the race and writes its rows...
    await backfillSeverity(incidentSeverity(SEV_NEW));
    const afterWinner: number = createdRules.length;
    expect(afterWinner).toBeGreaterThan(0);

    const readsBefore: number = ruleFindOneBySpy.mock.calls.length;

    // ...and the loser is still working from the snapshot it took earlier.
    await backfillSeverity(incidentSeverity(SEV_NEW));

    expect(createdRules).toHaveLength(afterWinner);

    /*
     * It really did reach the write path and get stopped there - had the stale
     * snapshot been what stopped it, no existence check would have been issued.
     */
    expect(ruleFindOneBySpy.mock.calls.length).toBeGreaterThan(readsBefore);
  });

  /*
   * The existence check keys on the delay as well as the method. A responder
   * who asked for "email me now" AND "email me in fifteen minutes" must get
   * both rows on the new severity; a key that ignored the delay would drop the
   * second one during the same pass that wrote the first.
   */
  test("two rules that differ only by delay both survive the existence check", async () => {
    verifiedEmails = [{ userId: USER_A, emailId: EMAIL_A }];

    seedRule({
      userId: USER_A,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      incidentSeverityId: SEV_1,
      userEmailId: EMAIL_A,
      notifyAfterMinutes: 0,
    });
    seedRule({
      userId: USER_A,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      incidentSeverityId: SEV_1,
      userEmailId: EMAIL_A,
      notifyAfterMinutes: 15,
    });

    await backfillSeverity(incidentSeverity(SEV_NEW));

    const shapes: Array<string> = shapesCreatedFor(
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    );

    expect(shapes.sort()).toEqual([
      `userEmailId:${EMAIL_A.toString()}@0`,
      `userEmailId:${EMAIL_A.toString()}@15`,
    ]);
  });

  test("a responder already covered by hand is left completely alone", async () => {
    verifiedEmails = [{ userId: USER_A, emailId: EMAIL_A }];

    seedRule({
      userId: USER_A,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      incidentSeverityId: SEV_1,
      userCallId: CALL_A,
      notifyAfterMinutes: 0,
    });
    // They already wrote their own rule for the new severity.
    seedRule({
      userId: USER_A,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      incidentSeverityId: SEV_NEW,
      userEmailId: EMAIL_A,
      notifyAfterMinutes: 45,
    });

    await backfillSeverity(incidentSeverity(SEV_NEW));

    expect(
      createdOfType(NotificationRuleType.ON_CALL_EXECUTED_INCIDENT),
    ).toHaveLength(0);
  });

  /*
   * The existence check has to name the new severity, or a rule for Sev1 would
   * satisfy it and the new severity would stay uncovered forever - which is the
   * original bug wearing a different hat.
   */
  test("the pre-write check names the whole row: project, user, type, severity, method and delay", async () => {
    verifiedEmails = [];

    seedRule({
      userId: USER_A,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      incidentSeverityId: SEV_1,
      userCallId: CALL_A,
      notifyAfterMinutes: 20,
    });

    await backfillSeverity(incidentSeverity(SEV_NEW));

    const query: Record<string, unknown> = queryOf(ruleFindOneBySpy, 0);

    expect(idOf(query["projectId"])).toBe(PROJECT_ID.toString());
    expect(idOf(query["userId"])).toBe(USER_A.toString());
    expect(query["ruleType"]).toBe(
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    );
    expect(idOf(query["incidentSeverityId"])).toBe(SEV_NEW.toString());
    expect(idOf(query["userCallId"])).toBe(CALL_A.toString());
    expect(query["notifyAfterMinutes"]).toBe(20);
    expect(query["alertSeverityId"]).toBeUndefined();
    expect(propsOf(ruleFindOneBySpy, 0).isRoot).toBe(true);
  });

  test("an alert backfill's existence check names alertSeverityId instead", async () => {
    verifiedEmails = [{ userId: USER_A, emailId: EMAIL_A }];

    await backfillSeverity(alertSeverity(ALERT_SEV_NEW));

    const query: Record<string, unknown> = queryOf(ruleFindOneBySpy, 0);

    expect(idOf(query["alertSeverityId"])).toBe(ALERT_SEV_NEW.toString());
    expect(query["incidentSeverityId"]).toBeUndefined();
  });

  test("an opt-out row is not duplicated on a second run either", async () => {
    verifiedEmails = [{ userId: USER_A, emailId: EMAIL_A }];

    seedRule({
      userId: USER_A,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      incidentSeverityId: SEV_1,
      isOptOut: true,
      notifyAfterMinutes: 0,
    });

    await backfillSeverity(incidentSeverity(SEV_NEW));
    const afterFirstRun: number = createdRules.length;

    await backfillSeverity(incidentSeverity(SEV_NEW));

    expect(createdRules).toHaveLength(afterFirstRun);
    expect(
      createdOfType(NotificationRuleType.ON_CALL_EXECUTED_INCIDENT),
    ).toHaveLength(1);
  });
});

/*
 * ========================================================================= *
 * Alert severities take the identical route.
 * =========================================================================
 */

describe("backfillSeverity covers alert severities the same way", () => {
  test("an alert severity mirrors the responder's alert rules onto alertSeverityId", async () => {
    verifiedEmails = [{ userId: USER_A, emailId: EMAIL_A }];

    seedRule({
      userId: USER_A,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
      alertSeverityId: ALERT_SEV_1,
      userPushId: PUSH_A,
      notifyAfterMinutes: 0,
    });

    await backfillSeverity(alertSeverity(ALERT_SEV_NEW));

    const created: Array<UserNotificationRule> = createdOfType(
      NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    );

    expect(created).toHaveLength(1);
    expect(created[0]!.alertSeverityId!.toString()).toBe(
      ALERT_SEV_NEW.toString(),
    );
    expect(created[0]!.incidentSeverityId).toBeUndefined();
    expect(methodOf(created[0]!)).toBe(`userPushId:${PUSH_A.toString()}`);
  });

  test("an alert severity covers both alert rule types and no incident one", async () => {
    verifiedEmails = [{ userId: USER_A, emailId: EMAIL_A }];

    await backfillSeverity(alertSeverity(ALERT_SEV_NEW));

    const typesCovered: Array<NotificationRuleType | undefined> =
      createdRules.map(
        (rule: UserNotificationRule): NotificationRuleType | undefined => {
          return rule.ruleType;
        },
      );

    expect(typesCovered.sort()).toEqual([...ALERT_RULE_TYPES].sort());
  });

  test("an incident backfill never writes an alert rule type", async () => {
    verifiedEmails = [{ userId: USER_A, emailId: EMAIL_A }];

    seedRule({
      userId: USER_A,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
      alertSeverityId: ALERT_SEV_1,
      userPushId: PUSH_A,
      notifyAfterMinutes: 0,
    });

    await backfillSeverity(incidentSeverity(SEV_NEW));

    for (const ruleType of ALERT_RULE_TYPES) {
      expect(createdOfType(ruleType)).toHaveLength(0);
    }
  });

  test("alert severities are idempotent on a second run too", async () => {
    verifiedEmails = [{ userId: USER_A, emailId: EMAIL_A }];

    await backfillSeverity(alertSeverity(ALERT_SEV_NEW));
    const afterFirstRun: number = createdRules.length;

    await backfillSeverity(alertSeverity(ALERT_SEV_NEW));

    expect(createdRules).toHaveLength(afterFirstRun);
  });
});

/*
 * ========================================================================= *
 * The fan-out: bounded reads, and failure isolation.
 * =========================================================================
 */

describe("the fan-out is bounded and does not collapse on one responder", () => {
  function seedProjectWithUsers(count: number): void {
    verifiedEmails = [];

    for (let index: number = 0; index < count; index++) {
      verifiedEmails.push({
        userId: new ObjectID(`bulk-user-${index}`),
        emailId: new ObjectID(`bulk-user-email-${index}`),
      });
    }
  }

  /*
   * The N+1 this job was written to avoid: looping the project's responders and
   * asking the database once per responder per severity. Reads must be a
   * function of the RULE TYPES, not of the head-count.
   */
  test("reads do not grow with the number of responders", async () => {
    seedProjectWithUsers(25);

    await backfillSeverity(incidentSeverity(SEV_NEW));

    expect(createdRules).toHaveLength(50);

    // One responder read for the severity, one rule read per rule type.
    expect(userEmailFindAllBySpy).toHaveBeenCalledTimes(1);
    expect(ruleFindAllBySpy).toHaveBeenCalledTimes(INCIDENT_RULE_TYPES.length);
  });

  test("the project-wide rule read is scoped to the project and one rule type", async () => {
    seedProjectWithUsers(3);

    await backfillSeverity(incidentSeverity(SEV_NEW));

    const ruleTypesRead: Array<unknown> = ruleFindAllBySpy.mock.calls.map(
      (call: Array<unknown>): unknown => {
        return (call[0] as { query: Record<string, unknown> }).query[
          "ruleType"
        ];
      },
    );

    expect(ruleTypesRead.sort()).toEqual([...INCIDENT_RULE_TYPES].sort());
    expect(idOf(queryOf(ruleFindAllBySpy, 0)["projectId"])).toBe(
      PROJECT_ID.toString(),
    );
    expect(propsOf(ruleFindAllBySpy, 0).isRoot).toBe(true);
  });

  /*
   * findAllBy is the paging reader: it walks the table in LIMIT_MAX batches
   * rather than issuing one unbounded query, which is what keeps a project with
   * more responders than fit in a single page from being read in one gulp. The
   * real findAllBy runs here; only the underlying page read is stubbed.
   */
  test("responders are read in bounded pages, not one unbounded query", async () => {
    userEmailFindAllBySpy.mockRestore();

    const singleRow: UserEmail = userEmailRow(USER_A, EMAIL_A);
    let pageIndex: number = 0;

    const emailFindBySpy: jest.SpyInstance = jest
      .spyOn(UserEmailService, "findBy")
      .mockImplementation(((): Promise<Array<UserEmail>> => {
        pageIndex++;

        if (pageIndex === 1) {
          // A full page, which is what tells findAllBy to ask for another.
          return Promise.resolve(
            new Array<UserEmail>(LIMIT_MAX).fill(singleRow),
          );
        }

        return Promise.resolve([]);
      }) as never);

    await backfillSeverity(incidentSeverity(SEV_NEW));

    expect(emailFindBySpy).toHaveBeenCalledTimes(2);

    const firstPage: { skip: number; limit: number } = emailFindBySpy.mock
      .calls[0]![0] as { skip: number; limit: number };
    const secondPage: { skip: number; limit: number } = emailFindBySpy.mock
      .calls[1]![0] as { skip: number; limit: number };

    expect(firstPage.skip).toBe(0);
    expect(firstPage.limit).toBe(LIMIT_MAX);
    expect(secondPage.skip).toBe(LIMIT_MAX);
    expect(secondPage.limit).toBe(LIMIT_MAX);

    // The page was one responder repeated, so one responder is covered.
    expect(createdRules).toHaveLength(INCIDENT_RULE_TYPES.length);
  });

  /*
   * The likeliest real failure: a method row deleted between the existence
   * check and the write, which cascades the foreign key away. That is worth a
   * log line for one person, not an aborted backfill for the whole project.
   */
  test("a write that fails for one responder does not stop the others", async () => {
    verifiedEmails = [
      { userId: USER_A, emailId: EMAIL_A },
      { userId: USER_B, emailId: EMAIL_B },
      { userId: USER_C, emailId: EMAIL_C },
    ];

    ruleCreateSpy.mockImplementation(((data: {
      data: UserNotificationRule;
    }): Promise<UserNotificationRule> => {
      const rule: UserNotificationRule = data.data;

      if (rule.userId && rule.userId.toString() === USER_B.toString()) {
        return Promise.reject(
          new Error("insert or update violates foreign key constraint"),
        );
      }

      rule._id = `created-rule-${createdRules.length + 1}`;
      ruleStore.push(rule);
      createdRules.push(rule);

      return Promise.resolve(rule);
    }) as never);

    await expect(
      backfillSeverity(incidentSeverity(SEV_NEW)),
    ).resolves.toBeUndefined();

    const usersCovered: Array<string> = createdRules.map(
      (rule: UserNotificationRule): string => {
        return rule.userId!.toString();
      },
    );

    expect(usersCovered).toContain(USER_A.toString());
    expect(usersCovered).toContain(USER_C.toString());
    expect(usersCovered).not.toContain(USER_B.toString());
    expect(createdRules).toHaveLength(4);

    // And the responder who was missed is named, not silently dropped.
    const logged: Array<string> = loggerErrorSpy.mock.calls.map(
      (call: Array<unknown>): string => {
        return String(call[0]);
      },
    );

    expect(
      logged.some((message: string): boolean => {
        return message.includes(USER_B.toString());
      }),
    ).toBe(true);
  });

  /*
   * The boundary of that isolation, pinned so a future reader knows where it
   * is: only the WRITE is wrapped. A failing existence READ propagates and ends
   * this severity's pass. It is not a lost page - the sweep re-derives its work
   * set from an hour-wide window every five minutes, so the responders after
   * the failure are picked up by a later tick - but the rest of THIS pass does
   * not happen.
   */
  test("a failing existence read ends this pass, leaving the rest to the next sweep", async () => {
    verifiedEmails = [
      { userId: USER_A, emailId: EMAIL_A },
      { userId: USER_B, emailId: EMAIL_B },
      { userId: USER_C, emailId: EMAIL_C },
    ];

    ruleFindOneBySpy.mockImplementation(((data: {
      query: Record<string, unknown>;
    }): Promise<UserNotificationRule | null> => {
      if (idOf(data.query["userId"]) === USER_B.toString()) {
        return Promise.reject(new Error("connection terminated unexpectedly"));
      }

      return Promise.resolve(matchingRules(ruleStore, data.query)[0] || null);
    }) as never);

    await expect(backfillSeverity(incidentSeverity(SEV_NEW))).rejects.toThrow(
      "connection terminated unexpectedly",
    );

    const usersCovered: Array<string> = createdRules.map(
      (rule: UserNotificationRule): string => {
        return rule.userId!.toString();
      },
    );

    expect(usersCovered).toEqual([USER_A.toString()]);
  });

  test("a project with nobody in it is a pair of reads and no writes", async () => {
    verifiedEmails = [];

    await expect(
      backfillSeverity(incidentSeverity(SEV_NEW)),
    ).resolves.toBeUndefined();

    expect(createdRules).toHaveLength(0);
    expect(ruleCreateSpy).not.toHaveBeenCalled();
    expect(ruleFindOneBySpy).not.toHaveBeenCalled();
  });
});
