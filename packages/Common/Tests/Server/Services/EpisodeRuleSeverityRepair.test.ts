import RepairEpisodeNotificationRuleSeverity from "../../../../App/FeatureSet/Workers/DataMigrations/RepairEpisodeNotificationRuleSeverity";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import UserNotificationRuleService, {
  NotificationMethodDescriptor,
} from "../../../Server/Services/UserNotificationRuleService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import logger from "../../../Server/Utils/Logger";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Model from "../../../Models/DatabaseModels/UserNotificationRule";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";
import fs from "fs";
import path from "path";
import { FindOperator } from "typeorm";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * GAP G: the episode notification rules that pointed at no severity.
 *
 * A UserNotificationRule is matched to a page by (ruleType x severity). The
 * on-call path counts them with a CONCRETE severity id in the query -
 * UserOnCallLogService reads `alertEpisode.alertSeverityId` /
 * `incidentEpisode.incidentSeverityId` and hands it straight to countBy - and
 * `NULL = '<uuid>'` is never true in SQL. So a rule with a NULL severity id is
 * not "a rule that matches everything"; it is a rule that matches NOTHING.
 *
 * That is what the defaults used to create. `createIncidentOnCallRules` and
 * `createAlertOnCallRules` seeded their two rule types once per severity, but
 * the two EPISODE rule types went through `createSingleRule`, which sets only
 * `ruleType` and `notifyAfterMinutes`. Every responder who took the defaults -
 * which is everyone who never opened User Settings - therefore had two episode
 * "rules" that could not be reached by any alert-episode or incident-episode
 * page. The system said they were covered. They were not.
 *
 * This file covers both halves of the fix.
 *
 *   HALF 1 - creation.
 *   `addDefaultNotificationRulesForVerifiedMethod` now seeds the two episode
 *   rule types per severity, alert episodes against AlertSeverity and incident
 *   episodes against IncidentSeverity. The severity MODEL each type is scoped
 *   by is asserted explicitly and with disjoint, differently-sized id sets,
 *   because crossing the two lists is the natural way to get this wrong and it
 *   fails silently: alert severity ids on incident-episode rules produce rows
 *   that are perfectly well-formed, perfectly visible, and still match no page
 *   ever. WHEN_USER_GOES_ON_CALL and WHEN_USER_GOES_OFF_CALL keep going
 *   through the single-rule path with no severity at all, because they are
 *   about the responder's shift rather than about anything that fired - they
 *   are the two rule types for which severity-less is CORRECT, and conflating
 *   them with the episode types is the mirror-image mistake.
 *
 *   HALF 2 - repair. `RepairEpisodeNotificationRuleSeverity` (a data migration
 *   in App/FeatureSet/Workers/DataMigrations, registered in that folder's
 *   Index.ts) fixes the rows already written: each NULL-severity episode rule
 *   becomes one row per severity in its project, preserving the notification
 *   method FK and `notifyAfterMinutes` so the responder's stated intent -
 *   "reach me HERE, after THIS long" - survives the repair.
 *
 * WHY THE MIGRATION DELETES THE NULL ORIGINALS RATHER THAN LEAVING THEM.
 * Leaving a row is normally the conservative choice, so the opposite call is
 * worth stating precisely. These rows are unreachable AND invisible at the
 * same time:
 *
 *   1. Unreachable. The count query the on-call path runs always supplies a
 *      concrete severity id, so a NULL row can never be counted, can never be
 *      executed, and can never page anybody. That is true by construction, not
 *      merely likely.
 *   2. Invisible. Both episode rule pages in the dashboard
 *      (UserSettings/EpisodeOnCallRules.tsx and
 *      UserSettings/IncidentEpisodeOnCallRules.tsx) scope their ModelTable by
 *      a severity id, exactly as the non-episode pages do. A row with no
 *      severity renders in no table on any page.
 *
 * So the user can neither be paged by the row nor see it nor delete it. Left
 * behind it is pure clutter that only ever surfaces as an inflated rule count
 * in some future readiness or compliance number - and the replacement rows
 * carry everything it expressed. Deleting loses nothing; keeping costs a lie.
 *
 * The migration's most dangerous possible over-reach is the opposite of its
 * job: sweeping up the shift rules, which are legitimately severity-less and
 * whose fan-out would create rules that fire on every severity change of a
 * responder's roster. That case, and the "already has a severity" and
 * "not an episode rule type" cases, are all pinned below.
 *
 * Nothing here touches Postgres. Half 1 stubs the two severity services and
 * the rule service's own findOneBy/create. Half 2 runs the migration against
 * an in-memory stand-in for the user_notification_rule table that honours the
 * query's rule type and NULL-severity filter, the `_id ASC` ordering and the
 * skip/limit window - so the paging cursor, the drain condition and the
 * idempotence are exercised for real rather than asserted against a script of
 * canned pages.
 */

/*
 * ------------------------------------------------------------------ *
 * Fixtures shared by both halves.
 * ------------------------------------------------------------------
 */

const PROJECT_A: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_B: ObjectID = new ObjectID(
  "11111111-2222-4111-8111-111111111111",
);
const PROJECT_NO_SEVERITIES: ObjectID = new ObjectID(
  "11111111-3333-4111-8111-111111111111",
);

const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "22222222-3333-4222-8222-222222222222",
);

/*
 * Deliberately disjoint id sets, and deliberately different sizes (3 incident
 * vs 2 alert). A fan-out that reached for the wrong severity list would still
 * produce plausible-looking rows, so the count is the second, independent
 * signal that the right list was used.
 */
const INCIDENT_SEV_1: ObjectID = new ObjectID(
  "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const INCIDENT_SEV_2: ObjectID = new ObjectID(
  "aaaaaaa2-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const INCIDENT_SEV_3: ObjectID = new ObjectID(
  "aaaaaaa3-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);

const ALERT_SEV_1: ObjectID = new ObjectID(
  "bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const ALERT_SEV_2: ObjectID = new ObjectID(
  "bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);

/* Project B's severities, so "fans out over ITS OWN project" is observable. */
const PROJECT_B_INCIDENT_SEV: ObjectID = new ObjectID(
  "aaaaaaa9-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const PROJECT_B_ALERT_SEV: ObjectID = new ObjectID(
  "bbbbbbb9-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);

const INCIDENT_SEVERITY_IDS: Array<ObjectID> = [
  INCIDENT_SEV_1,
  INCIDENT_SEV_2,
  INCIDENT_SEV_3,
];

const ALERT_SEVERITY_IDS: Array<ObjectID> = [ALERT_SEV_1, ALERT_SEV_2];

const EMAIL_METHOD_ID: ObjectID = new ObjectID(
  "ccccccc1-cccc-4ccc-8ccc-cccccccccccc",
);
const TELEGRAM_METHOD_ID: ObjectID = new ObjectID(
  "ccccccc2-cccc-4ccc-8ccc-cccccccccccc",
);

/* The nine FK columns a rule can name a notification method through. */
type MethodColumn =
  | "userEmailId"
  | "userSmsId"
  | "userCallId"
  | "userWhatsAppId"
  | "userTelegramId"
  | "userSlackId"
  | "userMicrosoftTeamsId"
  | "userWebhookId"
  | "userPushId";

const ALL_METHOD_COLUMNS: Array<MethodColumn> = [
  "userEmailId",
  "userSmsId",
  "userCallId",
  "userWhatsAppId",
  "userTelegramId",
  "userSlackId",
  "userMicrosoftTeamsId",
  "userWebhookId",
  "userPushId",
];

const EPISODE_RULE_TYPES: Array<NotificationRuleType> = [
  NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
  NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
];

/* The two rule types for which "no severity" is the correct answer. */
const SHIFT_RULE_TYPES: Array<NotificationRuleType> = [
  NotificationRuleType.WHEN_USER_GOES_ON_CALL,
  NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
];

function makeAlertSeverity(id: ObjectID): AlertSeverity {
  const severity: AlertSeverity = new AlertSeverity(id);
  severity._id = id.toString();

  return severity;
}

function makeIncidentSeverity(id: ObjectID): IncidentSeverity {
  const severity: IncidentSeverity = new IncidentSeverity(id);
  severity._id = id.toString();

  return severity;
}

function toStrings(ids: Array<ObjectID>): Array<string> {
  return ids.map((id: ObjectID): string => {
    return id.toString();
  });
}

/*
 * ------------------------------------------------------------------ *
 * HALF 1 - what the defaults create.
 * ------------------------------------------------------------------
 */

describe("GAP G half 1 - addDefaultNotificationRulesForVerifiedMethod seeds episode rules per severity", () => {
  let seedCreateSpy: jest.SpyInstance;
  let seedFindOneBySpy: jest.SpyInstance;
  let seedAlertSeveritiesSpy: jest.SpyInstance;
  let seedIncidentSeveritiesSpy: jest.SpyInstance;

  function seededRules(): Array<Model> {
    return seedCreateSpy.mock.calls.map((call: Array<unknown>): Model => {
      return (call[0] as CreateBy<Model>).data;
    });
  }

  function seededRulesOfType(ruleType: NotificationRuleType): Array<Model> {
    return seededRules().filter((rule: Model): boolean => {
      return rule.ruleType === ruleType;
    });
  }

  function duplicateCheckQueries(): Array<Record<string, unknown>> {
    return seedFindOneBySpy.mock.calls.map(
      (call: Array<unknown>): Record<string, unknown> => {
        return (call[0] as { query: Record<string, unknown> }).query;
      },
    );
  }

  function seedFor(
    notificationMethod: NotificationMethodDescriptor,
  ): Promise<void> {
    return UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod(
      {
        projectId: PROJECT_A,
        userId: USER_ID,
        notificationMethod: notificationMethod,
      },
    );
  }

  function seedForEmail(): Promise<void> {
    return seedFor({ userEmailId: EMAIL_METHOD_ID });
  }

  beforeEach(() => {
    seedIncidentSeveritiesSpy = jest
      .spyOn(IncidentSeverityService, "findBy")
      .mockResolvedValue(
        INCIDENT_SEVERITY_IDS.map(makeIncidentSeverity) as never,
      );

    seedAlertSeveritiesSpy = jest
      .spyOn(AlertSeverityService, "findBy")
      .mockResolvedValue(ALERT_SEVERITY_IDS.map(makeAlertSeverity) as never);

    // Nothing exists yet, so every candidate rule is created.
    seedFindOneBySpy = jest.spyOn(UserNotificationRuleService, "findOneBy");
    seedFindOneBySpy.mockResolvedValue(null as never);

    seedCreateSpy = jest.spyOn(UserNotificationRuleService, "create");
    seedCreateSpy.mockImplementation(
      (createBy: CreateBy<Model>): Promise<Model> => {
        return Promise.resolve(createBy.data);
      },
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("one ALERT episode rule per alert severity, each carrying that severity id", async () => {
    await seedForEmail();

    const episodeRules: Array<Model> = seededRulesOfType(
      NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    );

    expect(episodeRules).toHaveLength(ALERT_SEVERITY_IDS.length);
    expect(
      episodeRules.map((rule: Model): string => {
        return rule.alertSeverityId!.toString();
      }),
    ).toEqual(toStrings(ALERT_SEVERITY_IDS));
  });

  test("one INCIDENT episode rule per incident severity, each carrying that severity id", async () => {
    await seedForEmail();

    const episodeRules: Array<Model> = seededRulesOfType(
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
    );

    expect(episodeRules).toHaveLength(INCIDENT_SEVERITY_IDS.length);
    expect(
      episodeRules.map((rule: Model): string => {
        return rule.incidentSeverityId!.toString();
      }),
    ).toEqual(toStrings(INCIDENT_SEVERITY_IDS));
  });

  test("alert episode rules are scoped by the ALERT severity model, never the incident one", async () => {
    /*
     * The crossing bug. Handing `createSeverityScopedRules` the incident list
     * for the alert-episode rule type would write rows whose alertSeverityId
     * is an IncidentSeverity's primary key - a foreign key pointing into the
     * wrong table, which no alert episode's severity id will ever equal. The
     * rows would look fine in every log and page nobody, so both halves are
     * asserted: the ids are drawn from the alert list, and none of them comes
     * from the incident list.
     */
    await seedForEmail();

    const incidentIds: Array<string> = toStrings(INCIDENT_SEVERITY_IDS);

    for (const rule of seededRulesOfType(
      NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    )) {
      expect(toStrings(ALERT_SEVERITY_IDS)).toContain(
        rule.alertSeverityId!.toString(),
      );
      expect(incidentIds).not.toContain(rule.alertSeverityId!.toString());
      expect(rule.incidentSeverityId).toBeUndefined();
    }
  });

  test("incident episode rules are scoped by the INCIDENT severity model, never the alert one", async () => {
    await seedForEmail();

    const alertIds: Array<string> = toStrings(ALERT_SEVERITY_IDS);

    for (const rule of seededRulesOfType(
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
    )) {
      expect(toStrings(INCIDENT_SEVERITY_IDS)).toContain(
        rule.incidentSeverityId!.toString(),
      );
      expect(alertIds).not.toContain(rule.incidentSeverityId!.toString());
      expect(rule.alertSeverityId).toBeUndefined();
    }
  });

  test("the count of each episode rule type tracks its OWN severity list, not the other one", async () => {
    /*
     * A second, count-based check on the same crossing bug, with the two list
     * lengths pulled far apart so a swap cannot coincidentally agree: four
     * alert severities and one incident severity must give four alert-episode
     * rules and one incident-episode rule, not the reverse.
     */
    const alertSeverityIds: Array<ObjectID> = [
      ALERT_SEV_1,
      ALERT_SEV_2,
      PROJECT_B_ALERT_SEV,
      new ObjectID("bbbbbbb4-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
    ];

    seedAlertSeveritiesSpy.mockResolvedValue(
      alertSeverityIds.map(makeAlertSeverity) as never,
    );
    seedIncidentSeveritiesSpy.mockResolvedValue([
      makeIncidentSeverity(INCIDENT_SEV_1),
    ] as never);

    await seedForEmail();

    expect(
      seededRulesOfType(NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE),
    ).toHaveLength(4);
    expect(
      seededRulesOfType(NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE),
    ).toHaveLength(1);
  });

  test("no episode rule is created without a severity - the createSingleRule path is gone for these two", async () => {
    /*
     * The precise statement of GAP G. One severity-less episode row is enough
     * to reintroduce it, so this asserts over every episode row rather than
     * over a count.
     */
    await seedForEmail();

    const episodeRules: Array<Model> = seededRules().filter(
      (rule: Model): boolean => {
        return EPISODE_RULE_TYPES.includes(rule.ruleType!);
      },
    );

    expect(episodeRules).toHaveLength(
      ALERT_SEVERITY_IDS.length + INCIDENT_SEVERITY_IDS.length,
    );

    for (const rule of episodeRules) {
      expect(
        Boolean(rule.alertSeverityId) || Boolean(rule.incidentSeverityId),
      ).toBe(true);
    }
  });

  test("the ONLY severity-less rules seeded are the two shift rules", async () => {
    /*
     * The complement of the assertion above, and the guard against
     * over-correcting: WHEN_USER_GOES_ON_CALL / OFF_CALL describe the
     * responder's roster rather than anything that fired, so they carry no
     * severity by design and must keep going through createSingleRule.
     */
    await seedForEmail();

    const severityLessRules: Array<Model> = seededRules().filter(
      (rule: Model): boolean => {
        return !rule.alertSeverityId && !rule.incidentSeverityId;
      },
    );

    expect(
      severityLessRules.map((rule: Model): NotificationRuleType => {
        return rule.ruleType!;
      }),
    ).toEqual(SHIFT_RULE_TYPES);
  });

  test("each shift rule is seeded exactly once, regardless of how many severities exist", async () => {
    await seedForEmail();

    for (const ruleType of SHIFT_RULE_TYPES) {
      expect(seededRulesOfType(ruleType)).toHaveLength(1);
    }
  });

  test("the shift rules' duplicate check carries no severity key at all", async () => {
    /*
     * `createSingleRule` is private, so the observable signature of "this went
     * through the single-rule path" is its lookup: project + user + method +
     * ruleType and nothing else. An episode type appearing here without a
     * severity key would mean GAP G had returned.
     */
    await seedForEmail();

    const queries: Array<Record<string, unknown>> = duplicateCheckQueries();

    const shiftQueries: Array<Record<string, unknown>> = queries.filter(
      (query: Record<string, unknown>): boolean => {
        return SHIFT_RULE_TYPES.includes(
          query["ruleType"] as NotificationRuleType,
        );
      },
    );

    expect(shiftQueries).toHaveLength(SHIFT_RULE_TYPES.length);

    for (const query of shiftQueries) {
      expect(Object.keys(query)).not.toContain("alertSeverityId");
      expect(Object.keys(query)).not.toContain("incidentSeverityId");
    }
  });

  test("every episode rule's duplicate check IS keyed on a severity", async () => {
    await seedForEmail();

    const episodeQueries: Array<Record<string, unknown>> =
      duplicateCheckQueries().filter(
        (query: Record<string, unknown>): boolean => {
          return EPISODE_RULE_TYPES.includes(
            query["ruleType"] as NotificationRuleType,
          );
        },
      );

    expect(episodeQueries).toHaveLength(
      ALERT_SEVERITY_IDS.length + INCIDENT_SEVERITY_IDS.length,
    );

    for (const query of episodeQueries) {
      const isAlertEpisode: boolean =
        query["ruleType"] ===
        NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE;

      const severityId: unknown = isAlertEpisode
        ? query["alertSeverityId"]
        : query["incidentSeverityId"];

      expect(severityId).toBeDefined();
      expect(
        toStrings(
          isAlertEpisode ? ALERT_SEVERITY_IDS : INCIDENT_SEVERITY_IDS,
        ).includes((severityId as ObjectID).toString()),
      ).toBe(true);
    }
  });

  test("the verified method lands on every episode rule, on its own column only", async () => {
    await seedFor({ userTelegramId: TELEGRAM_METHOD_ID });

    const episodeRules: Array<Model> = seededRules().filter(
      (rule: Model): boolean => {
        return EPISODE_RULE_TYPES.includes(rule.ruleType!);
      },
    );

    expect(episodeRules).toHaveLength(
      ALERT_SEVERITY_IDS.length + INCIDENT_SEVERITY_IDS.length,
    );

    for (const rule of episodeRules) {
      expect(rule.userTelegramId!.toString()).toBe(
        TELEGRAM_METHOD_ID.toString(),
      );

      for (const column of ALL_METHOD_COLUMNS) {
        if (column === "userTelegramId") {
          continue;
        }
        expect(rule[column]).toBeUndefined();
      }
    }
  });

  test("every seeded episode rule pages immediately and belongs to the project and user", async () => {
    await seedForEmail();

    for (const rule of seededRules().filter((rule: Model): boolean => {
      return EPISODE_RULE_TYPES.includes(rule.ruleType!);
    })) {
      expect(rule.notifyAfterMinutes).toBe(0);
      expect(rule.projectId!.toString()).toBe(PROJECT_A.toString());
      expect(rule.userId!.toString()).toBe(USER_ID.toString());
    }
  });

  test("a project with no ALERT severities gets no alert-episode rules but keeps its incident ones", async () => {
    /*
     * Episode rules follow the severities now, so "none of that kind exist"
     * has to mean "seed none" rather than "seed one severity-less row" - which
     * is exactly the shape the old createSingleRule call had.
     */
    seedAlertSeveritiesSpy.mockResolvedValue([] as never);

    await seedForEmail();

    expect(
      seededRulesOfType(NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE),
    ).toHaveLength(0);
    expect(
      seededRulesOfType(NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE),
    ).toHaveLength(INCIDENT_SEVERITY_IDS.length);

    for (const ruleType of SHIFT_RULE_TYPES) {
      expect(seededRulesOfType(ruleType)).toHaveLength(1);
    }
  });

  test("a project with no severities of either kind still seeds the two shift rules and nothing else", async () => {
    seedAlertSeveritiesSpy.mockResolvedValue([] as never);
    seedIncidentSeveritiesSpy.mockResolvedValue([] as never);

    await seedForEmail();

    expect(
      seededRules().map((rule: Model): NotificationRuleType => {
        return rule.ruleType!;
      }),
    ).toEqual(SHIFT_RULE_TYPES);
  });
});

/*
 * ------------------------------------------------------------------ *
 * HALF 2 - the repair migration.
 * ------------------------------------------------------------------
 */

/* The shape of a findBy the migration issues against the rule table. */
interface RuleFindByArgs {
  query: Record<string, unknown>;
  select?: Record<string, boolean> | undefined;
  sort?: Record<string, SortOrder> | undefined;
  skip?: number | undefined;
  limit?: number | undefined;
  props?: { isRoot?: boolean | undefined } | undefined;
}

interface RuleSeed {
  id: ObjectID;
  ruleType: NotificationRuleType;
  projectId?: ObjectID | undefined;
  userId?: ObjectID | undefined;
  notifyAfterMinutes?: number | undefined;
  alertSeverityId?: ObjectID | undefined;
  incidentSeverityId?: ObjectID | undefined;
  methodColumn?: MethodColumn | undefined;
  methodId?: ObjectID | undefined;
}

function makeRule(seed: RuleSeed): Model {
  const rule: Model = new Model(seed.id);
  rule._id = seed.id.toString();
  rule.ruleType = seed.ruleType;

  if (seed.projectId) {
    rule.projectId = seed.projectId;
  }

  if (seed.userId) {
    rule.userId = seed.userId;
  }

  if (seed.notifyAfterMinutes !== undefined) {
    rule.notifyAfterMinutes = seed.notifyAfterMinutes;
  }

  if (seed.alertSeverityId) {
    rule.alertSeverityId = seed.alertSeverityId;
  }

  if (seed.incidentSeverityId) {
    rule.incidentSeverityId = seed.incidentSeverityId;
  }

  if (seed.methodColumn && seed.methodId) {
    rule[seed.methodColumn] = seed.methodId;
  }

  return rule;
}

/* Ids of rows the fixtures reference by name. */
const NULL_ALERT_EPISODE_ID: ObjectID = new ObjectID(
  "d0000001-dddd-4ddd-8ddd-dddddddddddd",
);
const NULL_INCIDENT_EPISODE_ID: ObjectID = new ObjectID(
  "d0000002-dddd-4ddd-8ddd-dddddddddddd",
);
const SCOPED_ALERT_EPISODE_ID: ObjectID = new ObjectID(
  "d0000003-dddd-4ddd-8ddd-dddddddddddd",
);
const NULL_ALERT_ON_CALL_ID: ObjectID = new ObjectID(
  "d0000004-dddd-4ddd-8ddd-dddddddddddd",
);
const NULL_INCIDENT_ON_CALL_ID: ObjectID = new ObjectID(
  "d0000005-dddd-4ddd-8ddd-dddddddddddd",
);
const GOES_ON_CALL_ID: ObjectID = new ObjectID(
  "d0000006-dddd-4ddd-8ddd-dddddddddddd",
);
const GOES_OFF_CALL_ID: ObjectID = new ObjectID(
  "d0000007-dddd-4ddd-8ddd-dddddddddddd",
);
const NO_METHOD_ID: ObjectID = new ObjectID(
  "d0000008-dddd-4ddd-8ddd-dddddddddddd",
);
const NO_PROJECT_ID: ObjectID = new ObjectID(
  "d0000009-dddd-4ddd-8ddd-dddddddddddd",
);
const PROJECT_B_NULL_ALERT_EPISODE_ID: ObjectID = new ObjectID(
  "d000000a-dddd-4ddd-8ddd-dddddddddddd",
);
const ORPHAN_PROJECT_NULL_EPISODE_ID: ObjectID = new ObjectID(
  "d000000b-dddd-4ddd-8ddd-dddddddddddd",
);

/* A NULL-severity alert-episode rule: exactly what the old defaults wrote. */
function nullAlertEpisodeRule(overrides?: Partial<RuleSeed>): Model {
  return makeRule({
    id: NULL_ALERT_EPISODE_ID,
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    projectId: PROJECT_A,
    userId: USER_ID,
    notifyAfterMinutes: 15,
    methodColumn: "userTelegramId",
    methodId: TELEGRAM_METHOD_ID,
    ...overrides,
  });
}

function nullIncidentEpisodeRule(overrides?: Partial<RuleSeed>): Model {
  return makeRule({
    id: NULL_INCIDENT_EPISODE_ID,
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
    projectId: PROJECT_A,
    userId: USER_ID,
    notifyAfterMinutes: 0,
    methodColumn: "userEmailId",
    methodId: EMAIL_METHOD_ID,
    ...overrides,
  });
}

describe("GAP G half 2 - RepairEpisodeNotificationRuleSeverity", () => {
  /* The in-memory stand-in for the user_notification_rule table. */
  let table: Array<Model> = [];
  /* An ordered log of the writes, so "delete only after create" is testable. */
  let events: Array<string> = [];
  let findByCalls: Array<RuleFindByArgs> = [];
  let createdRuleCounter: number = 0;

  let ruleFindBySpy: jest.SpyInstance;
  let ruleFindOneBySpy: jest.SpyInstance;
  let ruleCreateSpy: jest.SpyInstance;
  let ruleDeleteSpy: jest.SpyInstance;
  let alertSeveritiesSpy: jest.SpyInstance;
  let incidentSeveritiesSpy: jest.SpyInstance;

  const alertSeveritiesByProject: Map<string, Array<ObjectID>> = new Map<
    string,
    Array<ObjectID>
  >();
  const incidentSeveritiesByProject: Map<string, Array<ObjectID>> = new Map<
    string,
    Array<ObjectID>
  >();

  function runMigration(): Promise<void> {
    return new RepairEpisodeNotificationRuleSeverity().migrate();
  }

  function createdRules(): Array<Model> {
    return ruleCreateSpy.mock.calls.map((call: Array<unknown>): Model => {
      return (call[0] as CreateBy<Model>).data;
    });
  }

  function createdRulesOfType(ruleType: NotificationRuleType): Array<Model> {
    return createdRules().filter((rule: Model): boolean => {
      return rule.ruleType === ruleType;
    });
  }

  function deletedRuleIds(): Array<string> {
    return ruleDeleteSpy.mock.calls.map((call: Array<unknown>): string => {
      return (call[0] as { id: ObjectID }).id.toString();
    });
  }

  function tableIds(): Array<string> {
    return table.map((rule: Model): string => {
      return rule._id!;
    });
  }

  function findByCallsForRuleType(
    ruleType: NotificationRuleType,
  ): Array<RuleFindByArgs> {
    return findByCalls.filter((call: RuleFindByArgs): boolean => {
      return call.query["ruleType"] === ruleType;
    });
  }

  /* Does this stored row satisfy every key of the given query? */
  function matchesQuery(rule: Model, query: Record<string, unknown>): boolean {
    return Object.keys(query).every((key: string): boolean => {
      const expected: unknown = query[key];
      const actual: unknown = (rule as unknown as Record<string, unknown>)[key];

      if (expected instanceof ObjectID) {
        return (
          actual instanceof ObjectID &&
          actual.toString() === expected.toString()
        );
      }

      return actual === expected;
    });
  }

  beforeEach(() => {
    table = [];
    events = [];
    findByCalls = [];
    createdRuleCounter = 0;

    alertSeveritiesByProject.clear();
    incidentSeveritiesByProject.clear();
    alertSeveritiesByProject.set(PROJECT_A.toString(), ALERT_SEVERITY_IDS);
    alertSeveritiesByProject.set(PROJECT_B.toString(), [PROJECT_B_ALERT_SEV]);
    alertSeveritiesByProject.set(PROJECT_NO_SEVERITIES.toString(), []);
    incidentSeveritiesByProject.set(
      PROJECT_A.toString(),
      INCIDENT_SEVERITY_IDS,
    );
    incidentSeveritiesByProject.set(PROJECT_B.toString(), [
      PROJECT_B_INCIDENT_SEV,
    ]);
    incidentSeveritiesByProject.set(PROJECT_NO_SEVERITIES.toString(), []);

    /*
     * The paging read. This honours the parts of the query the migration's
     * correctness rests on - the rule type, the IS NULL severity filter, the
     * `_id ASC` ordering and the skip/limit window - so a cursor that failed
     * to advance would hang the loop here exactly as it would in production,
     * rather than being papered over by a scripted sequence of pages.
     */
    ruleFindBySpy = jest.spyOn(UserNotificationRuleService, "findBy");
    ruleFindBySpy.mockImplementation(
      (findBy: RuleFindByArgs): Promise<Array<Model>> => {
        findByCalls.push(findBy);

        const ruleType: unknown = findBy.query["ruleType"];
        const isAlertEpisodeQuery: boolean =
          findBy.query["alertSeverityId"] !== undefined;

        const matching: Array<Model> = table
          .filter((rule: Model): boolean => {
            if (rule.ruleType !== ruleType) {
              return false;
            }

            return isAlertEpisodeQuery
              ? !rule.alertSeverityId
              : !rule.incidentSeverityId;
          })
          .sort((first: Model, second: Model): number => {
            return (first._id || "").localeCompare(second._id || "");
          });

        const skip: number = findBy.skip ?? 0;
        const limit: number = findBy.limit ?? matching.length;

        return Promise.resolve(matching.slice(skip, skip + limit));
      },
    );

    /* The duplicate check that makes the pass idempotent and restartable. */
    ruleFindOneBySpy = jest.spyOn(UserNotificationRuleService, "findOneBy");
    ruleFindOneBySpy.mockImplementation(
      (findOneBy: {
        query: Record<string, unknown>;
      }): Promise<Model | null> => {
        const found: Model | undefined = table.find((rule: Model): boolean => {
          return matchesQuery(rule, findOneBy.query);
        });

        return Promise.resolve(found ?? null);
      },
    );

    ruleCreateSpy = jest.spyOn(UserNotificationRuleService, "create");
    ruleCreateSpy.mockImplementation(
      (createBy: CreateBy<Model>): Promise<Model> => {
        const created: Model = createBy.data;
        createdRuleCounter++;
        created._id = `cccccccc-0000-4000-8000-${String(createdRuleCounter).padStart(12, "0")}`;

        const severityId: ObjectID | undefined =
          created.alertSeverityId || created.incidentSeverityId;

        events.push(`create:${severityId ? severityId.toString() : "none"}`);
        table.push(created);

        return Promise.resolve(created);
      },
    );

    ruleDeleteSpy = jest.spyOn(UserNotificationRuleService, "deleteOneById");
    ruleDeleteSpy.mockImplementation(
      (deleteById: { id: ObjectID }): Promise<number> => {
        events.push(`delete:${deleteById.id.toString()}`);

        const index: number = table.findIndex((rule: Model): boolean => {
          return rule._id === deleteById.id.toString();
        });

        if (index < 0) {
          return Promise.resolve(0);
        }

        table.splice(index, 1);

        return Promise.resolve(1);
      },
    );

    alertSeveritiesSpy = jest.spyOn(AlertSeverityService, "findBy");
    alertSeveritiesSpy.mockImplementation(
      (findBy: {
        query: { projectId: ObjectID };
      }): Promise<Array<AlertSeverity>> => {
        const ids: Array<ObjectID> =
          alertSeveritiesByProject.get(findBy.query.projectId.toString()) ?? [];

        return Promise.resolve(ids.map(makeAlertSeverity));
      },
    );

    incidentSeveritiesSpy = jest.spyOn(IncidentSeverityService, "findBy");
    incidentSeveritiesSpy.mockImplementation(
      (findBy: {
        query: { projectId: ObjectID };
      }): Promise<Array<IncidentSeverity>> => {
        const ids: Array<ObjectID> =
          incidentSeveritiesByProject.get(findBy.query.projectId.toString()) ??
          [];

        return Promise.resolve(ids.map(makeIncidentSeverity));
      },
    );

    jest.spyOn(logger, "debug").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("fanning a NULL-severity episode rule out", () => {
    test("an alert episode rule becomes one rule per ALERT severity in its project", async () => {
      table = [nullAlertEpisodeRule()];

      await runMigration();

      const created: Array<Model> = createdRules();

      expect(created).toHaveLength(ALERT_SEVERITY_IDS.length);
      expect(
        created.map((rule: Model): string => {
          return rule.alertSeverityId!.toString();
        }),
      ).toEqual(toStrings(ALERT_SEVERITY_IDS));

      for (const rule of created) {
        expect(rule.ruleType).toBe(
          NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
        );
        expect(rule.incidentSeverityId).toBeUndefined();
      }
    });

    test("an incident episode rule becomes one rule per INCIDENT severity in its project", async () => {
      table = [nullIncidentEpisodeRule()];

      await runMigration();

      const created: Array<Model> = createdRules();

      expect(created).toHaveLength(INCIDENT_SEVERITY_IDS.length);
      expect(
        created.map((rule: Model): string => {
          return rule.incidentSeverityId!.toString();
        }),
      ).toEqual(toStrings(INCIDENT_SEVERITY_IDS));

      for (const rule of created) {
        expect(rule.ruleType).toBe(
          NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
        );
        expect(rule.alertSeverityId).toBeUndefined();
      }
    });

    test("neither fan-out borrows the other kind's severity ids", async () => {
      /*
       * The repair's version of the crossing bug: an alert-episode row fanned
       * out over incident severities would be just as unreachable as the NULL
       * row it replaced, and the migration would then delete the evidence.
       */
      table = [nullAlertEpisodeRule(), nullIncidentEpisodeRule()];

      await runMigration();

      const alertIds: Array<string> = toStrings(ALERT_SEVERITY_IDS);
      const incidentIds: Array<string> = toStrings(INCIDENT_SEVERITY_IDS);

      for (const rule of createdRulesOfType(
        NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
      )) {
        expect(alertIds).toContain(rule.alertSeverityId!.toString());
        expect(incidentIds).not.toContain(rule.alertSeverityId!.toString());
      }

      for (const rule of createdRulesOfType(
        NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
      )) {
        expect(incidentIds).toContain(rule.incidentSeverityId!.toString());
        expect(alertIds).not.toContain(rule.incidentSeverityId!.toString());
      }

      expect(
        createdRulesOfType(NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE),
      ).toHaveLength(ALERT_SEVERITY_IDS.length);
      expect(
        createdRulesOfType(
          NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
        ),
      ).toHaveLength(INCIDENT_SEVERITY_IDS.length);
    });

    test("every replacement keeps the notification method the responder chose", async () => {
      /*
       * The whole point of a fan-out rather than a delete-and-reseed: a user
       * who said "reach me on Telegram" must not silently become an e-mail
       * user because the repair rebuilt from defaults.
       */
      table = [nullAlertEpisodeRule()];

      await runMigration();

      for (const rule of createdRules()) {
        expect(rule.userTelegramId!.toString()).toBe(
          TELEGRAM_METHOD_ID.toString(),
        );

        for (const column of ALL_METHOD_COLUMNS) {
          if (column === "userTelegramId") {
            continue;
          }
          expect(rule[column]).toBeUndefined();
        }
      }
    });

    test("every replacement keeps notifyAfterMinutes", async () => {
      /*
       * The delay is the other half of the responder's intent - it is what
       * makes them the second line rather than the first. Resetting it to 0
       * would page them immediately on every severity.
       */
      table = [nullAlertEpisodeRule({ notifyAfterMinutes: 15 })];

      await runMigration();

      for (const rule of createdRules()) {
        expect(rule.notifyAfterMinutes).toBe(15);
      }
    });

    test("notifyAfterMinutes defaults to 0 when the original carried none", async () => {
      // The column is NOT NULL, so `undefined` would fail at insert time.
      table = [nullAlertEpisodeRule({ notifyAfterMinutes: undefined })];

      await runMigration();

      expect(createdRules()).toHaveLength(ALERT_SEVERITY_IDS.length);
      for (const rule of createdRules()) {
        expect(rule.notifyAfterMinutes).toBe(0);
      }
    });

    test("every replacement is stamped with the original's project and user", async () => {
      table = [nullAlertEpisodeRule()];

      await runMigration();

      for (const rule of createdRules()) {
        expect(rule.projectId!.toString()).toBe(PROJECT_A.toString());
        expect(rule.userId!.toString()).toBe(USER_ID.toString());
      }
    });

    test("replacements and deletions are internal, root-scoped writes", async () => {
      table = [nullAlertEpisodeRule()];

      await runMigration();

      for (const call of ruleCreateSpy.mock.calls) {
        expect((call[0] as CreateBy<Model>).props.isRoot).toBe(true);
      }

      for (const call of ruleDeleteSpy.mock.calls) {
        expect((call[0] as { props: { isRoot: boolean } }).props.isRoot).toBe(
          true,
        );
      }
    });

    test("each rule fans out over its OWN project's severities", async () => {
      table = [
        nullAlertEpisodeRule(),
        nullAlertEpisodeRule({
          id: PROJECT_B_NULL_ALERT_EPISODE_ID,
          projectId: PROJECT_B,
        }),
      ];

      await runMigration();

      const projectARules: Array<Model> = createdRules().filter(
        (rule: Model): boolean => {
          return rule.projectId!.toString() === PROJECT_A.toString();
        },
      );
      const projectBRules: Array<Model> = createdRules().filter(
        (rule: Model): boolean => {
          return rule.projectId!.toString() === PROJECT_B.toString();
        },
      );

      expect(
        projectARules.map((rule: Model): string => {
          return rule.alertSeverityId!.toString();
        }),
      ).toEqual(toStrings(ALERT_SEVERITY_IDS));

      expect(
        projectBRules.map((rule: Model): string => {
          return rule.alertSeverityId!.toString();
        }),
      ).toEqual([PROJECT_B_ALERT_SEV.toString()]);
    });

    test("a project's severity list is read once, not once per rule", async () => {
      /*
       * The fan-out is per rule but the severity list is per project, and a
       * project with thousands of affected responders is the common shape of
       * this bug. Two rules in one project must still be one severity read.
       */
      table = [
        nullAlertEpisodeRule(),
        nullAlertEpisodeRule({
          id: PROJECT_B_NULL_ALERT_EPISODE_ID,
          userId: OTHER_USER_ID,
        }),
      ];

      await runMigration();

      expect(alertSeveritiesSpy).toHaveBeenCalledTimes(1);
      // No incident-episode rows at all, so that list is never needed.
      expect(incidentSeveritiesSpy).not.toHaveBeenCalled();
    });

    test("the severity read is scoped to the project, root-scoped and bounded", async () => {
      table = [nullAlertEpisodeRule()];

      await runMigration();

      const arg: {
        query: { projectId: ObjectID };
        props: { isRoot: boolean };
        limit: number;
        skip: number;
      } = alertSeveritiesSpy.mock.calls[0][0] as {
        query: { projectId: ObjectID };
        props: { isRoot: boolean };
        limit: number;
        skip: number;
      };

      expect(arg.query.projectId.toString()).toBe(PROJECT_A.toString());
      expect(arg.props.isRoot).toBe(true);
      expect(arg.limit).toBe(LIMIT_PER_PROJECT);
      expect(arg.skip).toBe(0);
    });
  });

  describe("removing the NULL original", () => {
    test("the NULL-severity row is deleted", async () => {
      /*
       * See the file header for why this row is removed rather than left: it
       * can never be counted by the severity-filtered query AND it renders in
       * no UI table, so the responder can neither be paged by it nor see it
       * nor delete it themselves.
       */
      table = [nullAlertEpisodeRule()];

      await runMigration();

      expect(deletedRuleIds()).toEqual([NULL_ALERT_EPISODE_ID.toString()]);
    });

    test("the deletion happens only after every replacement exists", async () => {
      /*
       * Ordering is the migration's crash-safety story: a throw part-way
       * through the fan-out must leave the original in place so the retry can
       * finish the job. Deleting first would turn a crash into data loss.
       */
      table = [nullAlertEpisodeRule()];

      await runMigration();

      expect(events).toEqual([
        `create:${ALERT_SEV_1.toString()}`,
        `create:${ALERT_SEV_2.toString()}`,
        `delete:${NULL_ALERT_EPISODE_ID.toString()}`,
      ]);
    });

    test("the end state is severity-scoped rows only - no NULL row survives", async () => {
      table = [nullAlertEpisodeRule(), nullIncidentEpisodeRule()];

      await runMigration();

      expect(table).toHaveLength(
        ALERT_SEVERITY_IDS.length + INCIDENT_SEVERITY_IDS.length,
      );

      for (const rule of table) {
        expect(
          Boolean(rule.alertSeverityId) || Boolean(rule.incidentSeverityId),
        ).toBe(true);
      }
    });
  });

  describe("rows it must not touch", () => {
    test("an episode rule that already carries a severity is left exactly as it was", async () => {
      /*
       * Scoped to a different responder so it cannot double as one of the
       * fan-out's own replacements - this asserts "not swept up", not "not
       * duplicated".
       */
      const alreadyScoped: Model = makeRule({
        id: SCOPED_ALERT_EPISODE_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
        projectId: PROJECT_A,
        userId: OTHER_USER_ID,
        notifyAfterMinutes: 30,
        alertSeverityId: ALERT_SEV_1,
        methodColumn: "userEmailId",
        methodId: EMAIL_METHOD_ID,
      });

      table = [nullAlertEpisodeRule(), alreadyScoped];

      await runMigration();

      expect(deletedRuleIds()).toEqual([NULL_ALERT_EPISODE_ID.toString()]);
      expect(tableIds()).toContain(SCOPED_ALERT_EPISODE_ID.toString());
      expect(alreadyScoped.notifyAfterMinutes).toBe(30);
      expect(alreadyScoped.alertSeverityId!.toString()).toBe(
        ALERT_SEV_1.toString(),
      );

      for (const rule of createdRules()) {
        expect(rule.userId!.toString()).toBe(USER_ID.toString());
      }
    });

    test("NULL-severity rules of a NON-episode rule type are left alone", async () => {
      const nonEpisodeRules: Array<Model> = [
        makeRule({
          id: NULL_ALERT_ON_CALL_ID,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
          projectId: PROJECT_A,
          userId: USER_ID,
          notifyAfterMinutes: 5,
          methodColumn: "userEmailId",
          methodId: EMAIL_METHOD_ID,
        }),
        makeRule({
          id: NULL_INCIDENT_ON_CALL_ID,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          projectId: PROJECT_A,
          userId: USER_ID,
          notifyAfterMinutes: 5,
          methodColumn: "userEmailId",
          methodId: EMAIL_METHOD_ID,
        }),
      ];

      table = [...nonEpisodeRules];

      await runMigration();

      expect(ruleCreateSpy).not.toHaveBeenCalled();
      expect(ruleDeleteSpy).not.toHaveBeenCalled();
      expect(tableIds()).toEqual([
        NULL_ALERT_ON_CALL_ID.toString(),
        NULL_INCIDENT_ON_CALL_ID.toString(),
      ]);
    });

    test("WHEN_USER_GOES_ON_CALL / OFF_CALL rules are never fanned out", async () => {
      /*
       * The migration's most dangerous possible over-reach. These two rule
       * types are severity-less BY DESIGN - they describe the responder's
       * roster, not anything that fired - so a repair keyed on "episode-ish
       * rule with no severity" that reached them would multiply every user's
       * shift rules by the severity count and then delete the originals.
       * Nothing about the result would look broken until people started
       * getting one "you are on call" message per severity.
       */
      const shiftRules: Array<Model> = [
        makeRule({
          id: GOES_ON_CALL_ID,
          ruleType: NotificationRuleType.WHEN_USER_GOES_ON_CALL,
          projectId: PROJECT_A,
          userId: USER_ID,
          notifyAfterMinutes: 0,
          methodColumn: "userEmailId",
          methodId: EMAIL_METHOD_ID,
        }),
        makeRule({
          id: GOES_OFF_CALL_ID,
          ruleType: NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
          projectId: PROJECT_A,
          userId: USER_ID,
          notifyAfterMinutes: 0,
          methodColumn: "userEmailId",
          methodId: EMAIL_METHOD_ID,
        }),
      ];

      table = [...shiftRules];

      await runMigration();

      expect(ruleCreateSpy).not.toHaveBeenCalled();
      expect(ruleDeleteSpy).not.toHaveBeenCalled();
      expect(tableIds()).toEqual([
        GOES_ON_CALL_ID.toString(),
        GOES_OFF_CALL_ID.toString(),
      ]);
    });

    test("the migration only ever asks for the two episode rule types", async () => {
      /*
       * Stronger than "the shift rules survived": the shift rows are never
       * even read, so no future edit to the row-level guards can reach them.
       */
      table = [
        nullAlertEpisodeRule(),
        makeRule({
          id: GOES_ON_CALL_ID,
          ruleType: NotificationRuleType.WHEN_USER_GOES_ON_CALL,
          projectId: PROJECT_A,
          userId: USER_ID,
          notifyAfterMinutes: 0,
          methodColumn: "userEmailId",
          methodId: EMAIL_METHOD_ID,
        }),
      ];

      await runMigration();

      const queriedRuleTypes: Set<unknown> = new Set<unknown>(
        findByCalls.map((call: RuleFindByArgs): unknown => {
          return call.query["ruleType"];
        }),
      );

      expect(queriedRuleTypes).toEqual(
        new Set<NotificationRuleType>(EPISODE_RULE_TYPES),
      );
    });

    test("a whole mixed table is repaired in exactly the two places it should be", async () => {
      const shiftRule: Model = makeRule({
        id: GOES_ON_CALL_ID,
        ruleType: NotificationRuleType.WHEN_USER_GOES_ON_CALL,
        projectId: PROJECT_A,
        userId: USER_ID,
        notifyAfterMinutes: 0,
        methodColumn: "userEmailId",
        methodId: EMAIL_METHOD_ID,
      });

      const scopedEpisodeRule: Model = makeRule({
        id: SCOPED_ALERT_EPISODE_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
        projectId: PROJECT_A,
        userId: OTHER_USER_ID,
        notifyAfterMinutes: 0,
        alertSeverityId: ALERT_SEV_1,
        methodColumn: "userEmailId",
        methodId: EMAIL_METHOD_ID,
      });

      const onCallRule: Model = makeRule({
        id: NULL_ALERT_ON_CALL_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
        projectId: PROJECT_A,
        userId: USER_ID,
        notifyAfterMinutes: 0,
        methodColumn: "userEmailId",
        methodId: EMAIL_METHOD_ID,
      });

      table = [
        nullAlertEpisodeRule(),
        nullIncidentEpisodeRule(),
        scopedEpisodeRule,
        onCallRule,
        shiftRule,
      ];

      await runMigration();

      expect(deletedRuleIds().sort()).toEqual(
        [
          NULL_ALERT_EPISODE_ID.toString(),
          NULL_INCIDENT_EPISODE_ID.toString(),
        ].sort(),
      );

      expect(createdRules()).toHaveLength(
        ALERT_SEVERITY_IDS.length + INCIDENT_SEVERITY_IDS.length,
      );

      for (const survivor of [scopedEpisodeRule, onCallRule, shiftRule]) {
        expect(tableIds()).toContain(survivor._id!);
      }
    });
  });

  describe("rows it deliberately leaves in place", () => {
    test("a NULL row with no notification method is left alone, not deleted", async () => {
      /*
       * Every row createSingleRule wrote carries exactly one method, so a
       * method-less row means something this migration does not understand.
       * Fanning it out would write rules that deliver nothing (and that
       * onBeforeCreate would reject); deleting it would destroy a row whose
       * meaning is unknown. Leaving it is the only defensible option.
       */
      table = [
        nullAlertEpisodeRule({
          id: NO_METHOD_ID,
          methodColumn: undefined,
          methodId: undefined,
        }),
      ];

      await runMigration();

      expect(ruleCreateSpy).not.toHaveBeenCalled();
      expect(ruleDeleteSpy).not.toHaveBeenCalled();
      expect(tableIds()).toEqual([NO_METHOD_ID.toString()]);
    });

    test("a NULL row with no projectId is left alone, not deleted", async () => {
      table = [
        nullAlertEpisodeRule({ id: NO_PROJECT_ID, projectId: undefined }),
      ];

      await runMigration();

      expect(ruleCreateSpy).not.toHaveBeenCalled();
      expect(ruleDeleteSpy).not.toHaveBeenCalled();
      expect(tableIds()).toEqual([NO_PROJECT_ID.toString()]);
    });

    test("a project with no severities of that kind keeps its row", async () => {
      /*
       * There is nothing to fan out to yet. Deleting would throw away the
       * responder's chosen method and delay for a severity that simply has
       * not been created; the row is equally unreachable either way, and the
       * severity-creation backfill mirrors it forward when the project's
       * first severity appears.
       */
      table = [
        nullAlertEpisodeRule({
          id: ORPHAN_PROJECT_NULL_EPISODE_ID,
          projectId: PROJECT_NO_SEVERITIES,
        }),
      ];

      await runMigration();

      expect(ruleCreateSpy).not.toHaveBeenCalled();
      expect(ruleDeleteSpy).not.toHaveBeenCalled();
      expect(tableIds()).toEqual([ORPHAN_PROJECT_NULL_EPISODE_ID.toString()]);
    });

    test("left-in-place rows advance the paging cursor so the sweep still drains", async () => {
      /*
       * The subtle failure mode of "skip the row and move on": a row left in
       * the table is returned again by the next page-zero query, so a cursor
       * that did not count it would re-read the same page forever and the
       * migration would never finish booting the pod. The skip offset is the
       * running count of rows left behind, which is sound because `_id ASC`
       * puts every already-seen row before every unseen one.
       */
      table = [
        nullAlertEpisodeRule({
          id: NO_METHOD_ID,
          methodColumn: undefined,
          methodId: undefined,
        }),
        nullAlertEpisodeRule({
          id: NO_PROJECT_ID,
          projectId: undefined,
        }),
        nullAlertEpisodeRule({
          id: ORPHAN_PROJECT_NULL_EPISODE_ID,
          projectId: PROJECT_NO_SEVERITIES,
        }),
        nullAlertEpisodeRule(),
      ];

      await runMigration();

      const alertPassSkips: Array<number | undefined> = findByCallsForRuleType(
        NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
      ).map((call: RuleFindByArgs): number | undefined => {
        return call.skip;
      });

      /*
       * One page returning all four rows, then a second read skipping the
       * three that stayed - which finds nothing and ends the loop.
       */
      expect(alertPassSkips).toEqual([0, 3]);
      expect(deletedRuleIds()).toEqual([NULL_ALERT_EPISODE_ID.toString()]);
      expect(table).toHaveLength(3 + ALERT_SEVERITY_IDS.length);
    });
  });

  describe("the query it runs", () => {
    test("the alert pass filters on a NULL alertSeverityId", async () => {
      table = [nullAlertEpisodeRule()];

      await runMigration();

      const call: RuleFindByArgs = findByCallsForRuleType(
        NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
      )[0]!;

      const operator: FindOperator<unknown> = call.query[
        "alertSeverityId"
      ] as FindOperator<unknown>;

      const getSql: ((aliasPath: string) => string) | undefined =
        operator.getSql;

      expect(getSql).toBeDefined();
      expect(getSql!("UserNotificationRule.alertSeverityId")).toBe(
        "(UserNotificationRule.alertSeverityId IS NULL)",
      );

      /*
       * The other severity column is not constrained at all: an alert-episode
       * rule has no incident severity to speak of.
       */
      expect(Object.keys(call.query)).not.toContain("incidentSeverityId");
    });

    test("the incident pass filters on a NULL incidentSeverityId", async () => {
      table = [nullIncidentEpisodeRule()];

      await runMigration();

      const call: RuleFindByArgs = findByCallsForRuleType(
        NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
      )[0]!;

      const getSql: ((aliasPath: string) => string) | undefined = (
        call.query["incidentSeverityId"] as FindOperator<unknown>
      ).getSql;

      expect(getSql).toBeDefined();
      expect(getSql!("UserNotificationRule.incidentSeverityId")).toBe(
        "(UserNotificationRule.incidentSeverityId IS NULL)",
      );
      expect(Object.keys(call.query)).not.toContain("alertSeverityId");
    });

    test("the read selects everything the fan-out has to copy forward", async () => {
      /*
       * The select is load-bearing in a way that fails silently: an
       * unselected `notifyAfterMinutes` arrives as undefined and is defaulted
       * to 0, which would quietly reset every responder's escalation delay
       * while the migration reported success. Same for the method FKs - a
       * dropped column turns into "carries no notification method" and the
       * row is skipped instead of repaired.
       */
      table = [nullAlertEpisodeRule()];

      await runMigration();

      const select: Record<string, boolean> = findByCallsForRuleType(
        NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
      )[0]!.select!;

      for (const key of [
        "_id",
        "projectId",
        "userId",
        "notifyAfterMinutes",
        ...ALL_METHOD_COLUMNS,
      ]) {
        expect(select[key]).toBe(true);
      }
    });

    test("the read is root-scoped", async () => {
      table = [nullAlertEpisodeRule()];

      await runMigration();

      for (const call of findByCalls) {
        expect(call.props!.isRoot).toBe(true);
      }
    });

    test("the duplicate check is keyed on project, user, rule type, severity and method", async () => {
      table = [nullAlertEpisodeRule()];

      await runMigration();

      const query: Record<string, unknown> = (
        ruleFindOneBySpy.mock.calls[0][0] as {
          query: Record<string, unknown>;
        }
      ).query;

      expect((query["projectId"] as ObjectID).toString()).toBe(
        PROJECT_A.toString(),
      );
      expect((query["userId"] as ObjectID).toString()).toBe(USER_ID.toString());
      expect(query["ruleType"]).toBe(
        NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
      );
      expect((query["alertSeverityId"] as ObjectID).toString()).toBe(
        ALERT_SEV_1.toString(),
      );
      expect((query["userTelegramId"] as ObjectID).toString()).toBe(
        TELEGRAM_METHOD_ID.toString(),
      );
    });
  });

  describe("paging", () => {
    test("it pages instead of loading every affected row at once", async () => {
      /*
       * Each row fans out into one INSERT per severity, so an unbounded read
       * would turn the repair into one enormous write burst against a table
       * the on-call path reads on every single page. 250 rows must arrive as
       * bounded pages, not as one array.
       */
      alertSeveritiesByProject.set(PROJECT_A.toString(), [ALERT_SEV_1]);

      /*
       * Each row must belong to a DIFFERENT responder. The repair is idempotent
       * by design: before writing, it asks findOneBy whether a rule already
       * exists for (project, user, ruleType, severity, method). 250 rows that
       * differ only by id describe the same rule 250 times, so the first one
       * would be repaired and the other 249 correctly skipped as duplicates -
       * which is the migration behaving properly, but it measures deduplication
       * rather than paging and leaves this test asserting the wrong thing.
       * Varying the user makes all 250 genuinely distinct repairs.
       */
      table = Array.from({ length: 250 }, (_unused: unknown, index: number) => {
        return nullAlertEpisodeRule({
          id: new ObjectID(
            `eeeeeeee-0000-4000-8000-${String(index).padStart(12, "0")}`,
          ),
          userId: new ObjectID(
            `dddddddd-0000-4000-8000-${String(index).padStart(12, "0")}`,
          ),
        });
      });

      await runMigration();

      const alertPassCalls: Array<RuleFindByArgs> = findByCallsForRuleType(
        NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
      );

      // Three full-ish pages plus the empty read that ends the loop.
      expect(alertPassCalls).toHaveLength(4);

      for (const call of alertPassCalls) {
        expect(call.limit).toBe(100);
        expect(call.limit!).toBeLessThan(LIMIT_MAX);
      }

      expect(ruleCreateSpy).toHaveBeenCalledTimes(250);
      expect(ruleDeleteSpy).toHaveBeenCalledTimes(250);
      expect(table).toHaveLength(250);
    });

    test("every page is ordered by _id ascending, which is what makes the cursor sound", async () => {
      table = [nullAlertEpisodeRule(), nullIncidentEpisodeRule()];

      await runMigration();

      expect(findByCalls.length).toBeGreaterThan(0);

      for (const call of findByCalls) {
        expect(call.sort).toEqual({ _id: SortOrder.Ascending });
      }
    });
  });

  describe("idempotence", () => {
    test("a second run over a repaired table writes nothing", async () => {
      table = [nullAlertEpisodeRule(), nullIncidentEpisodeRule()];

      await runMigration();

      const repairedIds: Array<string> = tableIds();

      ruleCreateSpy.mockClear();
      ruleDeleteSpy.mockClear();

      await runMigration();

      expect(ruleCreateSpy).not.toHaveBeenCalled();
      expect(ruleDeleteSpy).not.toHaveBeenCalled();
      expect(tableIds()).toEqual(repairedIds);
    });

    test("a half-finished pass is resumed without duplicating what it already wrote", async () => {
      /*
       * Restartability: the pod is killed after one replacement is inserted
       * but before the original is deleted. The re-run must fill in only the
       * missing severity - a duplicate here is a duplicate page.
       */
      const alreadyWritten: Model = makeRule({
        id: SCOPED_ALERT_EPISODE_ID,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
        projectId: PROJECT_A,
        userId: USER_ID,
        notifyAfterMinutes: 15,
        alertSeverityId: ALERT_SEV_1,
        methodColumn: "userTelegramId",
        methodId: TELEGRAM_METHOD_ID,
      });

      table = [nullAlertEpisodeRule(), alreadyWritten];

      await runMigration();

      expect(createdRules()).toHaveLength(1);
      expect(createdRules()[0]!.alertSeverityId!.toString()).toBe(
        ALERT_SEV_2.toString(),
      );
      expect(deletedRuleIds()).toEqual([NULL_ALERT_EPISODE_ID.toString()]);
      expect(table).toHaveLength(2);
    });

    test("running it twice does not double a responder's rules", async () => {
      table = [nullAlertEpisodeRule()];

      await runMigration();
      await runMigration();

      expect(table).toHaveLength(ALERT_SEVERITY_IDS.length);
      expect(
        table
          .map((rule: Model): string => {
            return rule.alertSeverityId!.toString();
          })
          .sort(),
      ).toEqual(toStrings(ALERT_SEVERITY_IDS).sort());
    });
  });

  describe("how it is wired in", () => {
    test("rollback is a deliberate no-op rather than the base class's throw", async () => {
      /*
       * DataMigrationBase.rollback throws NotImplementedException. This one
       * overrides it to do nothing on purpose: recreating the NULL originals
       * would restore rows that page nobody and that the responder can
       * neither see nor delete - the exact defect being removed.
       */
      await expect(
        new RepairEpisodeNotificationRuleSeverity().rollback(),
      ).resolves.toBeUndefined();
    });

    test("its recorded name matches the class name", () => {
      /*
       * The name is what the runner writes to the migrations table, so it is
       * the identity that decides whether this migration ever runs again.
       */
      expect(new RepairEpisodeNotificationRuleSeverity().name).toBe(
        "RepairEpisodeNotificationRuleSeverity",
      );
    });

    test("it is registered in the DataMigrations list", () => {
      /*
       * Source-level pin. Importing the list itself would drag in the whole
       * ClickHouse migration graph, so the registration - which is two edits,
       * an import and an array entry, and easy to half-do - is checked as
       * text instead. An unregistered migration is a repair that never runs.
       */
      const indexSource: string = fs.readFileSync(
        path.join(
          __dirname,
          "../../../../App/FeatureSet/Workers/DataMigrations/Index.ts",
        ),
        "utf8",
      );

      expect(indexSource).toContain(
        'import RepairEpisodeNotificationRuleSeverity from "./RepairEpisodeNotificationRuleSeverity";',
      );
      expect(indexSource).toContain(
        "new RepairEpisodeNotificationRuleSeverity()",
      );
    });
  });
});
