import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import UserEmailService from "../../../Server/Services/UserEmailService";
import UserNotificationRuleService, {
  NotificationMethodDescriptor,
} from "../../../Server/Services/UserNotificationRuleService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import Model from "../../../Models/DatabaseModels/UserNotificationRule";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Email from "../../../Types/Email";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The defaults a brand-new responder is given.
 *
 * Everything about "will this person actually be paged?" starts here. When a
 * user joins a project (TeamMemberService), verifies a phone / push / e-mail
 * / Telegram / WhatsApp / webhook identity (the UserXxxAPI verify endpoints),
 * or links a Slack / Microsoft Teams account (born verified from the OAuth
 * workspace link), UserNotificationRuleService seeds a set of notification
 * rules for them. If the
 * seeding is wrong — a severity skipped, a rule type missed, a delay that is not
 * zero, or the method id written onto the wrong foreign key — the user is on an
 * on-call policy that pages nobody, and nothing tells them so.
 *
 * This file pins the shape of that seeding:
 *
 *   (A) addDefaultNotificationRulesForVerifiedMethod
 *       - one ON_CALL_EXECUTED_INCIDENT rule per incident severity,
 *       - one ON_CALL_EXECUTED_ALERT rule per alert severity,
 *       - one ON_CALL_EXECUTED_INCIDENT_EPISODE rule per incident severity and
 *         one ON_CALL_EXECUTED_ALERT_EPISODE rule per alert severity (Phase 1
 *         closed GAP G here: these two used to be seeded once each with a NULL
 *         severity, which matched no severity-filtered page and showed up in no
 *         severity-scoped UI table - "defaults" that were unreachable and
 *         invisible at the same time),
 *       - exactly two "single" rules (goes on call, goes off call), which
 *         legitimately have no severity because they are about the user's shift
 *         rather than about anything that fired,
 *       - every rule at notifyAfterMinutes = 0 (page immediately),
 *       - the verified method's id written to exactly one FK column, chosen per
 *         channel, and the same column used in the duplicate lookup,
 *       - idempotence: an existing rule for a (method, severity, ruleType)
 *         triple suppresses only that one create, never its neighbours,
 *       - a project with zero severities gets the two shift rules and nothing
 *         else, because a rule for a severity that does not exist could never
 *         have matched a page anyway.
 *
 *   (B) addDefaultNotificationRuleForUser, which is the joining-a-project entry
 *       point: it materialises a *verified* UserEmail when one does not exist,
 *       reuses one when it does, and then delegates to (A).
 *
 * Nothing here touches Postgres: the two severity services, UserEmailService and
 * the service's own findOneBy/create are all stubbed, so what is asserted is the
 * decision-making, not the persistence.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

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

const METHOD_ID: ObjectID = new ObjectID(
  "ccccccc1-cccc-4ccc-8ccc-cccccccccccc",
);

const EXISTING_EMAIL_ID: ObjectID = new ObjectID(
  "ddddddd1-dddd-4ddd-8ddd-dddddddddddd",
);
const CREATED_EMAIL_ID: ObjectID = new ObjectID(
  "ddddddd2-dddd-4ddd-8ddd-dddddddddddd",
);

const USER_EMAIL: Email = new Email("responder@company.com");

/* The nine FK columns a NotificationMethodDescriptor can drive. */
type ChannelColumn =
  | "userEmailId"
  | "userSmsId"
  | "userCallId"
  | "userWhatsAppId"
  | "userTelegramId"
  | "userSlackId"
  | "userMicrosoftTeamsId"
  | "userWebhookId"
  | "userPushId";

const ALL_CHANNELS: Array<ChannelColumn> = [
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

/* The rule types that are seeded once, regardless of severities. */
const SINGLE_RULE_TYPES: Array<NotificationRuleType> = [
  NotificationRuleType.WHEN_USER_GOES_ON_CALL,
  NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
];

/*
 * The episode rule types. Since Phase 1 closed GAP G these are seeded once per
 * severity - alert episodes against alert severities, incident episodes against
 * incident severities - exactly like their non-episode counterparts.
 */
const EPISODE_RULE_TYPES: Array<NotificationRuleType> = [
  NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
  NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
];

/*
 * With the fixture below (3 incident severities, 2 alert severities):
 * 3 incident + 2 alert + 2 alert episode + 3 incident episode + 2 single.
 */
const TOTAL_SEEDED_RULES: number = 12;

/* The order the rules are seeded in, which is also the duplicate-check order. */
const SEEDED_RULE_ORDER: Array<NotificationRuleType> = [
  NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
  NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
  NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
  NotificationRuleType.ON_CALL_EXECUTED_ALERT,
  NotificationRuleType.ON_CALL_EXECUTED_ALERT,
  NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
  NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
  NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
  NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
  NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
  NotificationRuleType.WHEN_USER_GOES_ON_CALL,
  NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
];

function incidentSeverity(id: ObjectID): IncidentSeverity {
  const severity: IncidentSeverity = new IncidentSeverity(id);
  severity._id = id.toString();

  return severity;
}

function alertSeverity(id: ObjectID): AlertSeverity {
  const severity: AlertSeverity = new AlertSeverity(id);
  severity._id = id.toString();

  return severity;
}

function existingUserEmail(id: ObjectID, isVerified: boolean): UserEmail {
  const userEmail: UserEmail = new UserEmail(id);
  userEmail._id = id.toString();
  userEmail.projectId = PROJECT_ID;
  userEmail.userId = USER_ID;
  userEmail.email = USER_EMAIL;
  userEmail.isVerified = isVerified;

  return userEmail;
}

/* A rule row standing in for "this default already exists". */
function existingRule(): Model {
  const rule: Model = new Model(
    new ObjectID("eeeeeee1-eeee-4eee-8eee-eeeeeeeeeeee"),
  );

  return rule;
}

function descriptorFor(channel: ChannelColumn): NotificationMethodDescriptor {
  return { [channel]: METHOD_ID } as NotificationMethodDescriptor;
}

let findOneBySpy: jest.SpyInstance;
let createSpy: jest.SpyInstance;
let incidentSeveritiesSpy: jest.SpyInstance;
let alertSeveritiesSpy: jest.SpyInstance;
let userEmailFindOneBySpy: jest.SpyInstance;
let userEmailCreateSpy: jest.SpyInstance;

/* Every UserNotificationRule handed to create(), in the order it was created. */
function createdRules(): Array<Model> {
  return createSpy.mock.calls.map((call: Array<unknown>): Model => {
    return (call[0] as CreateBy<Model>).data;
  });
}

function createdRulesOfType(ruleType: NotificationRuleType): Array<Model> {
  return createdRules().filter((rule: Model): boolean => {
    return rule.ruleType === ruleType;
  });
}

/* Every query object handed to the service's own findOneBy duplicate check. */
function duplicateCheckQueries(): Array<Record<string, unknown>> {
  return findOneBySpy.mock.calls.map(
    (call: Array<unknown>): Record<string, unknown> => {
      return (call[0] as { query: Record<string, unknown> }).query;
    },
  );
}

function runForDescriptor(
  notificationMethod: NotificationMethodDescriptor,
): Promise<void> {
  return UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod(
    {
      projectId: PROJECT_ID,
      userId: USER_ID,
      notificationMethod: notificationMethod,
    },
  );
}

function runForEmailMethod(): Promise<void> {
  return runForDescriptor({ userEmailId: METHOD_ID });
}

beforeEach(() => {
  incidentSeveritiesSpy = jest
    .spyOn(IncidentSeverityService, "findBy")
    .mockResolvedValue([
      incidentSeverity(INCIDENT_SEV_1),
      incidentSeverity(INCIDENT_SEV_2),
      incidentSeverity(INCIDENT_SEV_3),
    ] as never);

  alertSeveritiesSpy = jest
    .spyOn(AlertSeverityService, "findBy")
    .mockResolvedValue([
      alertSeverity(ALERT_SEV_1),
      alertSeverity(ALERT_SEV_2),
    ] as never);

  // Nothing exists yet, so every candidate rule is created.
  findOneBySpy = jest.spyOn(UserNotificationRuleService, "findOneBy");
  findOneBySpy.mockResolvedValue(null as never);

  createSpy = jest.spyOn(UserNotificationRuleService, "create");
  createSpy.mockImplementation((createBy: CreateBy<Model>): Promise<Model> => {
    return Promise.resolve(createBy.data);
  });

  userEmailFindOneBySpy = jest
    .spyOn(UserEmailService, "findOneBy")
    .mockResolvedValue(null as never);

  userEmailCreateSpy = jest
    .spyOn(UserEmailService, "create")
    .mockResolvedValue(existingUserEmail(CREATED_EMAIL_ID, true) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("addDefaultNotificationRulesForVerifiedMethod - what gets seeded", () => {
  test("one incident on-call rule per incident severity in the project", async () => {
    await runForEmailMethod();

    const incidentRules: Array<Model> = createdRulesOfType(
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    );

    expect(incidentRules).toHaveLength(3);
    expect(
      incidentRules.map((rule: Model): string => {
        return rule.incidentSeverityId!.toString();
      }),
    ).toEqual([
      INCIDENT_SEV_1.toString(),
      INCIDENT_SEV_2.toString(),
      INCIDENT_SEV_3.toString(),
    ]);
  });

  test("an incident rule is scoped to its severity only - no alert severity leaks in", async () => {
    await runForEmailMethod();

    for (const rule of createdRulesOfType(
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    )) {
      expect(rule.alertSeverityId).toBeUndefined();
    }
  });

  test("one alert on-call rule per alert severity in the project", async () => {
    await runForEmailMethod();

    const alertRules: Array<Model> = createdRulesOfType(
      NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    );

    expect(alertRules).toHaveLength(2);
    expect(
      alertRules.map((rule: Model): string => {
        return rule.alertSeverityId!.toString();
      }),
    ).toEqual([ALERT_SEV_1.toString(), ALERT_SEV_2.toString()]);
  });

  test("an alert rule is scoped to its severity only - no incident severity leaks in", async () => {
    await runForEmailMethod();

    for (const rule of createdRulesOfType(
      NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    )) {
      expect(rule.incidentSeverityId).toBeUndefined();
    }
  });

  test("exactly two single rules are seeded, one of each non-severity rule type", async () => {
    await runForEmailMethod();

    for (const ruleType of SINGLE_RULE_TYPES) {
      expect(createdRulesOfType(ruleType)).toHaveLength(1);
    }
  });

  test("the two single rules carry no severity at all - they are not severity scoped", async () => {
    await runForEmailMethod();

    const singles: Array<Model> = createdRules().filter(
      (rule: Model): boolean => {
        return SINGLE_RULE_TYPES.includes(rule.ruleType!);
      },
    );

    expect(singles).toHaveLength(2);
    for (const rule of singles) {
      expect(rule.incidentSeverityId).toBeUndefined();
      expect(rule.alertSeverityId).toBeUndefined();
    }
  });

  test("one alert episode rule per ALERT severity, each carrying that severity", async () => {
    /*
     * GAP G, closed by Phase 1. These rows used to be created once with a NULL
     * alertSeverityId, which the severity-filtered count query in
     * UserOnCallLogService could never match - so every alert episode page for a
     * user on defaults was dropped.
     */
    await runForEmailMethod();

    const episodeRules: Array<Model> = createdRulesOfType(
      NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    );

    expect(episodeRules).toHaveLength(2);
    expect(
      episodeRules.map((rule: Model): string => {
        return rule.alertSeverityId!.toString();
      }),
    ).toEqual([ALERT_SEV_1.toString(), ALERT_SEV_2.toString()]);

    for (const rule of episodeRules) {
      expect(rule.incidentSeverityId).toBeUndefined();
    }
  });

  test("one incident episode rule per INCIDENT severity, each carrying that severity", async () => {
    // GAP G, closed by Phase 1 - see the alert episode case above.
    await runForEmailMethod();

    const episodeRules: Array<Model> = createdRulesOfType(
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
    );

    expect(episodeRules).toHaveLength(3);
    expect(
      episodeRules.map((rule: Model): string => {
        return rule.incidentSeverityId!.toString();
      }),
    ).toEqual([
      INCIDENT_SEV_1.toString(),
      INCIDENT_SEV_2.toString(),
      INCIDENT_SEV_3.toString(),
    ]);

    for (const rule of episodeRules) {
      expect(rule.alertSeverityId).toBeUndefined();
    }
  });

  test("no seeded episode rule is left without a severity", async () => {
    /*
     * The precise statement of GAP G: a NULL-severity episode rule matches no
     * page and appears in no UI table, so it is worse than no rule at all - the
     * user is told they are covered when they are not.
     */
    await runForEmailMethod();

    const episodeRules: Array<Model> = createdRules().filter(
      (rule: Model): boolean => {
        return EPISODE_RULE_TYPES.includes(rule.ruleType!);
      },
    );

    expect(episodeRules).toHaveLength(5);
    for (const rule of episodeRules) {
      expect(
        rule.alertSeverityId !== undefined ||
          rule.incidentSeverityId !== undefined,
      ).toBe(true);
    }
  });

  test("the total is incident + alert severities twice over, plus two, and nothing else", async () => {
    await runForEmailMethod();

    /*
     * 3 incident + 2 alert on-call rules, then 2 alert episode + 3 incident
     * episode rules, then the 2 shift rules.
     */
    expect(createSpy).toHaveBeenCalledTimes(TOTAL_SEEDED_RULES);
  });

  test("every seeded rule pages immediately - notifyAfterMinutes is 0", async () => {
    await runForEmailMethod();

    const rules: Array<Model> = createdRules();
    expect(rules).toHaveLength(TOTAL_SEEDED_RULES);
    for (const rule of rules) {
      expect(rule.notifyAfterMinutes).toBe(0);
    }
  });

  test("every seeded rule is stamped with the project and the user it belongs to", async () => {
    await runForEmailMethod();

    for (const rule of createdRules()) {
      expect(rule.projectId!.toString()).toBe(PROJECT_ID.toString());
      expect(rule.userId!.toString()).toBe(USER_ID.toString());
    }
  });

  test("every create is an internal, root-scoped write", async () => {
    await runForEmailMethod();

    for (const call of createSpy.mock.calls) {
      expect((call[0] as CreateBy<Model>).props.isRoot).toBe(true);
    }
  });

  test("rules are seeded on-call-first, then the episodes, then the singles in a fixed order", async () => {
    /*
     * The order is not load-bearing for correctness, but it is the order the
     * duplicate checks run in too, so pinning it makes a reordering visible.
     */
    await runForEmailMethod();

    expect(
      createdRules().map((rule: Model): NotificationRuleType => {
        return rule.ruleType!;
      }),
    ).toEqual(SEEDED_RULE_ORDER);
  });

  test("severities are read for this project only, root-scoped, and up to the per-project limit", async () => {
    /*
     * GAP A (OnCallNotificationReadiness.md 2.2): this read is a point-in-time
     * snapshot. Severities created after this call are never backfilled onto
     * existing users - pinned here so the backfill work has a baseline.
     *
     * Each list is read exactly ONCE even though it now drives two rule types
     * apiece (on-call and episode), which is why the counts below stay at one.
     */
    await runForEmailMethod();

    expect(incidentSeveritiesSpy).toHaveBeenCalledTimes(1);
    expect(alertSeveritiesSpy).toHaveBeenCalledTimes(1);

    for (const spy of [incidentSeveritiesSpy, alertSeveritiesSpy]) {
      const arg: {
        query: { projectId: ObjectID };
        props: { isRoot: boolean };
        limit: number;
        skip: number;
        select: Record<string, boolean>;
      } = spy.mock.calls[0][0] as {
        query: { projectId: ObjectID };
        props: { isRoot: boolean };
        limit: number;
        skip: number;
        select: Record<string, boolean>;
      };

      expect(arg.query.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(arg.props.isRoot).toBe(true);
      expect(arg.limit).toBe(LIMIT_PER_PROJECT);
      expect(arg.skip).toBe(0);
      expect(arg.select["_id"]).toBe(true);
    }
  });
});

describe("addDefaultNotificationRulesForVerifiedMethod - the method lands on the right column", () => {
  test.each(ALL_CHANNELS)(
    "a %s descriptor sets that column on every seeded rule and no other channel column",
    async (channel: ChannelColumn) => {
      await runForDescriptor(descriptorFor(channel));

      const rules: Array<Model> = createdRules();
      expect(rules).toHaveLength(TOTAL_SEEDED_RULES);

      for (const rule of rules) {
        expect(rule[channel]?.toString()).toBe(METHOD_ID.toString());

        for (const otherChannel of ALL_CHANNELS) {
          if (otherChannel === channel) {
            continue;
          }
          expect(rule[otherChannel]).toBeUndefined();
        }
      }
    },
  );

  test.each(ALL_CHANNELS)(
    "the duplicate check for a %s descriptor is keyed on that same column",
    async (channel: ChannelColumn) => {
      /*
       * If the lookup column and the write column ever diverge, the service
       * re-creates the same defaults on every verification - so they are
       * asserted together.
       */
      await runForDescriptor(descriptorFor(channel));

      const queries: Array<Record<string, unknown>> = duplicateCheckQueries();
      expect(queries).toHaveLength(TOTAL_SEEDED_RULES);

      for (const query of queries) {
        expect((query[channel] as ObjectID).toString()).toBe(
          METHOD_ID.toString(),
        );

        for (const otherChannel of ALL_CHANNELS) {
          if (otherChannel === channel) {
            continue;
          }
          expect(query[otherChannel]).toBeUndefined();
        }
      }
    },
  );

  test("a descriptor carrying several verified methods writes all of them onto one rule", async () => {
    /*
     * No caller does this today (each verify endpoint passes exactly one id),
     * but the descriptor permits it and applyNotificationMethod copies each
     * present key independently.
     */
    await runForDescriptor({
      userEmailId: METHOD_ID,
      userSmsId: EXISTING_EMAIL_ID,
      userPushId: CREATED_EMAIL_ID,
    });

    for (const rule of createdRules()) {
      expect(rule.userEmailId!.toString()).toBe(METHOD_ID.toString());
      expect(rule.userSmsId!.toString()).toBe(EXISTING_EMAIL_ID.toString());
      expect(rule.userPushId!.toString()).toBe(CREATED_EMAIL_ID.toString());
      expect(rule.userCallId).toBeUndefined();
    }
  });

  test("an EMPTY descriptor still seeds a full set of method-less rules", async () => {
    /*
     * KNOWN DEFECT, pinned as-is. With no id on the descriptor the duplicate
     * check degenerates to (projectId, userId, ruleType) and the created rows
     * carry no notification method at all - onBeforeCreate would reject them
     * with "Call, SMS, WhatsApp, Telegram, Slack, Microsoft Teams, Webhook,
     * Email, or Push notification is required" against a real database. Nothing
     * in this method guards against being handed an empty descriptor.
     */
    await runForDescriptor({});

    const rules: Array<Model> = createdRules();
    expect(rules).toHaveLength(TOTAL_SEEDED_RULES);

    for (const rule of rules) {
      for (const channel of ALL_CHANNELS) {
        expect(rule[channel]).toBeUndefined();
      }
    }

    for (const query of duplicateCheckQueries()) {
      for (const channel of ALL_CHANNELS) {
        expect(query[channel]).toBeUndefined();
      }
    }
  });

  test("the duplicate check is root-scoped and keyed on project, user and rule type", async () => {
    await runForEmailMethod();

    expect(findOneBySpy).toHaveBeenCalledTimes(TOTAL_SEEDED_RULES);

    for (const call of findOneBySpy.mock.calls) {
      const arg: {
        query: Record<string, unknown>;
        props: { isRoot: boolean };
      } = call[0] as {
        query: Record<string, unknown>;
        props: { isRoot: boolean };
      };

      expect((arg.query["projectId"] as ObjectID).toString()).toBe(
        PROJECT_ID.toString(),
      );
      expect((arg.query["userId"] as ObjectID).toString()).toBe(
        USER_ID.toString(),
      );
      expect(arg.query["ruleType"]).toBeDefined();
      expect(arg.props.isRoot).toBe(true);
    }
  });

  test("the severity duplicate checks carry the severity id they are checking", async () => {
    await runForEmailMethod();

    const queries: Array<Record<string, unknown>> = duplicateCheckQueries();

    expect(
      queries.slice(0, 3).map((query: Record<string, unknown>): string => {
        return (query["incidentSeverityId"] as ObjectID).toString();
      }),
    ).toEqual([
      INCIDENT_SEV_1.toString(),
      INCIDENT_SEV_2.toString(),
      INCIDENT_SEV_3.toString(),
    ]);

    expect(
      queries.slice(3, 5).map((query: Record<string, unknown>): string => {
        return (query["alertSeverityId"] as ObjectID).toString();
      }),
    ).toEqual([ALERT_SEV_1.toString(), ALERT_SEV_2.toString()]);

    // The episode checks are severity-keyed too, since Phase 1 closed GAP G.
    expect(
      queries.slice(5, 7).map((query: Record<string, unknown>): string => {
        return (query["alertSeverityId"] as ObjectID).toString();
      }),
    ).toEqual([ALERT_SEV_1.toString(), ALERT_SEV_2.toString()]);

    expect(
      queries.slice(7, 10).map((query: Record<string, unknown>): string => {
        return (query["incidentSeverityId"] as ObjectID).toString();
      }),
    ).toEqual([
      INCIDENT_SEV_1.toString(),
      INCIDENT_SEV_2.toString(),
      INCIDENT_SEV_3.toString(),
    ]);

    // Only the two shift rules are looked up without a severity.
    for (const query of queries.slice(10)) {
      expect(query["incidentSeverityId"]).toBeUndefined();
      expect(query["alertSeverityId"]).toBeUndefined();
    }
  });
});

describe("addDefaultNotificationRulesForVerifiedMethod - idempotence", () => {
  test("re-verifying a method that already has all its defaults creates nothing", async () => {
    /*
     * The verify endpoints call this every time a method is re-verified. A
     * second run must not double the user's rules (which would double every
     * page they receive).
     */
    findOneBySpy.mockResolvedValue(existingRule() as never);

    await runForEmailMethod();

    expect(findOneBySpy).toHaveBeenCalledTimes(TOTAL_SEEDED_RULES);
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("an existing rule for ONE incident severity suppresses only that severity", async () => {
    findOneBySpy.mockImplementation(
      (findBy: { query: Record<string, unknown> }): Promise<Model | null> => {
        const severityId: ObjectID | undefined = findBy.query[
          "incidentSeverityId"
        ] as ObjectID | undefined;

        if (severityId && severityId.toString() === INCIDENT_SEV_2.toString()) {
          return Promise.resolve(existingRule());
        }

        return Promise.resolve(null);
      },
    );

    await runForEmailMethod();

    /*
     * Two rows are suppressed, not one: the incident on-call rule for SEV_2 and
     * the incident EPISODE rule for SEV_2, both of which are now keyed on the
     * same severity.
     */
    expect(createSpy).toHaveBeenCalledTimes(TOTAL_SEEDED_RULES - 2);

    const incidentRules: Array<Model> = createdRulesOfType(
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    );
    expect(
      incidentRules.map((rule: Model): string => {
        return rule.incidentSeverityId!.toString();
      }),
    ).toEqual([INCIDENT_SEV_1.toString(), INCIDENT_SEV_3.toString()]);

    expect(
      createdRulesOfType(
        NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
      ).map((rule: Model): string => {
        return rule.incidentSeverityId!.toString();
      }),
    ).toEqual([INCIDENT_SEV_1.toString(), INCIDENT_SEV_3.toString()]);
  });

  test("an existing rule for ONE alert severity suppresses only that severity", async () => {
    findOneBySpy.mockImplementation(
      (findBy: { query: Record<string, unknown> }): Promise<Model | null> => {
        const severityId: ObjectID | undefined = findBy.query[
          "alertSeverityId"
        ] as ObjectID | undefined;

        if (severityId && severityId.toString() === ALERT_SEV_1.toString()) {
          return Promise.resolve(existingRule());
        }

        return Promise.resolve(null);
      },
    );

    await runForEmailMethod();

    // Again two rows: the alert on-call rule and the alert episode rule.
    expect(createSpy).toHaveBeenCalledTimes(TOTAL_SEEDED_RULES - 2);

    const alertRules: Array<Model> = createdRulesOfType(
      NotificationRuleType.ON_CALL_EXECUTED_ALERT,
    );
    expect(alertRules).toHaveLength(1);
    expect(alertRules[0]!.alertSeverityId!.toString()).toBe(
      ALERT_SEV_2.toString(),
    );

    const alertEpisodeRules: Array<Model> = createdRulesOfType(
      NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE,
    );
    expect(alertEpisodeRules).toHaveLength(1);
    expect(alertEpisodeRules[0]!.alertSeverityId!.toString()).toBe(
      ALERT_SEV_2.toString(),
    );
  });

  test("all incident severities covered still leaves the alert and single rules to seed", async () => {
    findOneBySpy.mockImplementation(
      (findBy: { query: Record<string, unknown> }): Promise<Model | null> => {
        return Promise.resolve(
          findBy.query["incidentSeverityId"] ? existingRule() : null,
        );
      },
    );

    await runForEmailMethod();

    /*
     * Every incident-severity-keyed row is suppressed - the 3 on-call rules and
     * the 3 episode rules - leaving 2 alert, 2 alert episode and 2 shift rules.
     */
    expect(createSpy).toHaveBeenCalledTimes(6);
    expect(
      createdRulesOfType(NotificationRuleType.ON_CALL_EXECUTED_INCIDENT),
    ).toHaveLength(0);
    expect(
      createdRulesOfType(
        NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
      ),
    ).toHaveLength(0);
    expect(
      createdRulesOfType(NotificationRuleType.ON_CALL_EXECUTED_ALERT),
    ).toHaveLength(2);
  });

  test.each(SINGLE_RULE_TYPES)(
    "an existing %s rule suppresses only that single rule",
    async (existingRuleType: NotificationRuleType) => {
      findOneBySpy.mockImplementation(
        (findBy: { query: Record<string, unknown> }): Promise<Model | null> => {
          return Promise.resolve(
            findBy.query["ruleType"] === existingRuleType
              ? existingRule()
              : null,
          );
        },
      );

      await runForEmailMethod();

      expect(createSpy).toHaveBeenCalledTimes(TOTAL_SEEDED_RULES - 1);
      expect(createdRulesOfType(existingRuleType)).toHaveLength(0);

      for (const otherRuleType of SINGLE_RULE_TYPES) {
        if (otherRuleType === existingRuleType) {
          continue;
        }
        expect(createdRulesOfType(otherRuleType)).toHaveLength(1);
      }
    },
  );

  test.each<[NotificationRuleType, number]>([
    [NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE, 2],
    [NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE, 3],
  ])(
    "existing %s rules for every severity suppress exactly %i rows",
    async (existingRuleType: NotificationRuleType, suppressedCount: number) => {
      /*
       * Episode rules are per-severity now, so "already seeded" is a statement
       * about one severity at a time - stubbing the whole rule type standing in
       * for a user who has all of them.
       */
      findOneBySpy.mockImplementation(
        (findBy: { query: Record<string, unknown> }): Promise<Model | null> => {
          return Promise.resolve(
            findBy.query["ruleType"] === existingRuleType
              ? existingRule()
              : null,
          );
        },
      );

      await runForEmailMethod();

      expect(createSpy).toHaveBeenCalledTimes(
        TOTAL_SEEDED_RULES - suppressedCount,
      );
      expect(createdRulesOfType(existingRuleType)).toHaveLength(0);
    },
  );

  test("a rule that exists for a DIFFERENT method does not suppress this method's defaults", async () => {
    /*
     * The duplicate query is keyed on the method column, so a user who already
     * has e-mail rules still gets a full set of SMS rules when they verify a
     * phone number.
     */
    findOneBySpy.mockImplementation(
      (findBy: { query: Record<string, unknown> }): Promise<Model | null> => {
        return Promise.resolve(
          findBy.query["userEmailId"] ? existingRule() : null,
        );
      },
    );

    await runForDescriptor({ userSmsId: METHOD_ID });

    expect(createSpy).toHaveBeenCalledTimes(TOTAL_SEEDED_RULES);
  });

  test("the duplicate check runs once per candidate rule - no extra reads", async () => {
    await runForEmailMethod();

    expect(findOneBySpy).toHaveBeenCalledTimes(createSpy.mock.calls.length);
  });
});

describe("addDefaultNotificationRulesForVerifiedMethod - a project with no severities", () => {
  test("no per-severity rules are seeded, but the two shift rules still are", async () => {
    /*
     * The episode rules follow the severities now, so a project with none gets
     * no episode rules either. That is the correct reading of GAP G: a rule for
     * a severity that does not exist could never have matched a page anyway.
     */
    incidentSeveritiesSpy.mockResolvedValue([] as never);
    alertSeveritiesSpy.mockResolvedValue([] as never);

    await runForEmailMethod();

    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(
      createdRules().map((rule: Model): NotificationRuleType => {
        return rule.ruleType!;
      }),
    ).toEqual(SINGLE_RULE_TYPES);
  });

  test("with no severities the duplicate check runs only for the two shift rules", async () => {
    incidentSeveritiesSpy.mockResolvedValue([] as never);
    alertSeveritiesSpy.mockResolvedValue([] as never);

    await runForEmailMethod();

    expect(findOneBySpy).toHaveBeenCalledTimes(2);
    for (const query of duplicateCheckQueries()) {
      expect(query["incidentSeverityId"]).toBeUndefined();
      expect(query["alertSeverityId"]).toBeUndefined();
    }
  });

  test("the shift rules still get the method and notifyAfterMinutes 0", async () => {
    incidentSeveritiesSpy.mockResolvedValue([] as never);
    alertSeveritiesSpy.mockResolvedValue([] as never);

    await runForDescriptor({ userCallId: METHOD_ID });

    for (const rule of createdRules()) {
      expect(rule.userCallId!.toString()).toBe(METHOD_ID.toString());
      expect(rule.notifyAfterMinutes).toBe(0);
    }
  });

  test("only incident severities missing still seeds the alert rules", async () => {
    incidentSeveritiesSpy.mockResolvedValue([] as never);

    await runForEmailMethod();

    // 0 incident + 2 alert + 2 alert episode + 0 incident episode + 2 shift.
    expect(createSpy).toHaveBeenCalledTimes(6);
    expect(
      createdRulesOfType(NotificationRuleType.ON_CALL_EXECUTED_ALERT),
    ).toHaveLength(2);
    expect(
      createdRulesOfType(NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE),
    ).toHaveLength(2);
    expect(
      createdRulesOfType(
        NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
      ),
    ).toHaveLength(0);
  });

  test("only alert severities missing still seeds the incident rules", async () => {
    alertSeveritiesSpy.mockResolvedValue([] as never);

    await runForEmailMethod();

    // 3 incident + 0 alert + 0 alert episode + 3 incident episode + 2 shift.
    expect(createSpy).toHaveBeenCalledTimes(8);
    expect(
      createdRulesOfType(NotificationRuleType.ON_CALL_EXECUTED_INCIDENT),
    ).toHaveLength(3);
    expect(
      createdRulesOfType(
        NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
      ),
    ).toHaveLength(3);
    expect(
      createdRulesOfType(NotificationRuleType.ON_CALL_EXECUTED_ALERT_EPISODE),
    ).toHaveLength(0);
  });
});

describe("addDefaultNotificationRuleForUser - materialising the e-mail identity", () => {
  test("a user with no UserEmail row gets one created, already verified", async () => {
    await UserNotificationRuleService.addDefaultNotificationRuleForUser(
      PROJECT_ID,
      USER_ID,
      USER_EMAIL,
    );

    expect(userEmailCreateSpy).toHaveBeenCalledTimes(1);

    const created: UserEmail = (
      userEmailCreateSpy.mock.calls[0][0] as CreateBy<UserEmail>
    ).data;

    expect(created.projectId!.toString()).toBe(PROJECT_ID.toString());
    expect(created.userId!.toString()).toBe(USER_ID.toString());
    expect(created.email!.toString()).toBe(USER_EMAIL.toString());
    /*
     * The join path trusts the address the account already verified, so the
     * row is born verified - otherwise the user would have to verify an
     * address they never typed in.
     */
    expect(created.isVerified).toBe(true);
  });

  test("the UserEmail is created as an internal, root-scoped write", async () => {
    await UserNotificationRuleService.addDefaultNotificationRuleForUser(
      PROJECT_ID,
      USER_ID,
      USER_EMAIL,
    );

    expect(
      (userEmailCreateSpy.mock.calls[0][0] as CreateBy<UserEmail>).props.isRoot,
    ).toBe(true);
  });

  test("the lookup is by project, user AND address, root-scoped", async () => {
    await UserNotificationRuleService.addDefaultNotificationRuleForUser(
      PROJECT_ID,
      USER_ID,
      USER_EMAIL,
    );

    expect(userEmailFindOneBySpy).toHaveBeenCalledTimes(1);

    const arg: {
      query: { projectId: ObjectID; userId: ObjectID; email: Email };
      props: { isRoot: boolean };
    } = userEmailFindOneBySpy.mock.calls[0][0] as {
      query: { projectId: ObjectID; userId: ObjectID; email: Email };
      props: { isRoot: boolean };
    };

    expect(arg.query.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(arg.query.userId.toString()).toBe(USER_ID.toString());
    expect(arg.query.email.toString()).toBe(USER_EMAIL.toString());
    expect(arg.props.isRoot).toBe(true);
  });

  test("the newly created e-mail's id is the one the default rules are hung off", async () => {
    await UserNotificationRuleService.addDefaultNotificationRuleForUser(
      PROJECT_ID,
      USER_ID,
      USER_EMAIL,
    );

    const rules: Array<Model> = createdRules();
    expect(rules).toHaveLength(TOTAL_SEEDED_RULES);
    for (const rule of rules) {
      expect(rule.userEmailId!.toString()).toBe(CREATED_EMAIL_ID.toString());
      expect(rule.userSmsId).toBeUndefined();
      expect(rule.userCallId).toBeUndefined();
    }
  });

  test("it delegates to addDefaultNotificationRulesForVerifiedMethod with exactly that descriptor", async () => {
    const delegateSpy: jest.SpyInstance = jest
      .spyOn(
        UserNotificationRuleService,
        "addDefaultNotificationRulesForVerifiedMethod",
      )
      .mockResolvedValue(undefined as never);

    await UserNotificationRuleService.addDefaultNotificationRuleForUser(
      PROJECT_ID,
      USER_ID,
      USER_EMAIL,
    );

    expect(delegateSpy).toHaveBeenCalledTimes(1);

    const arg: {
      projectId: ObjectID;
      userId: ObjectID;
      notificationMethod: NotificationMethodDescriptor;
    } = delegateSpy.mock.calls[0][0] as {
      projectId: ObjectID;
      userId: ObjectID;
      notificationMethod: NotificationMethodDescriptor;
    };

    expect(arg.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(arg.userId.toString()).toBe(USER_ID.toString());
    expect(Object.keys(arg.notificationMethod)).toEqual(["userEmailId"]);
    expect(arg.notificationMethod.userEmailId!.toString()).toBe(
      CREATED_EMAIL_ID.toString(),
    );
  });
});

describe("addDefaultNotificationRuleForUser - reusing an existing e-mail identity", () => {
  beforeEach(() => {
    userEmailFindOneBySpy.mockResolvedValue(
      existingUserEmail(EXISTING_EMAIL_ID, true) as never,
    );
  });

  test("no second UserEmail row is created", async () => {
    await UserNotificationRuleService.addDefaultNotificationRuleForUser(
      PROJECT_ID,
      USER_ID,
      USER_EMAIL,
    );

    expect(userEmailCreateSpy).not.toHaveBeenCalled();
  });

  test("the existing row's id is what the default rules point at", async () => {
    await UserNotificationRuleService.addDefaultNotificationRuleForUser(
      PROJECT_ID,
      USER_ID,
      USER_EMAIL,
    );

    const rules: Array<Model> = createdRules();
    expect(rules).toHaveLength(TOTAL_SEEDED_RULES);
    for (const rule of rules) {
      expect(rule.userEmailId!.toString()).toBe(EXISTING_EMAIL_ID.toString());
    }
  });

  test("re-running for a user who already has the defaults creates nothing at all", async () => {
    findOneBySpy.mockResolvedValue(existingRule() as never);

    await UserNotificationRuleService.addDefaultNotificationRuleForUser(
      PROJECT_ID,
      USER_ID,
      USER_EMAIL,
    );

    expect(userEmailCreateSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  test("an UNVERIFIED existing e-mail is reused as-is and still gets default rules", async () => {
    /*
     * KNOWN DEFECT, pinned as-is. The reuse branch never inspects isVerified,
     * so a project e-mail the user has not confirmed becomes the target of
     * every default on-call rule - and is neither verified nor rejected here.
     */
    userEmailFindOneBySpy.mockResolvedValue(
      existingUserEmail(EXISTING_EMAIL_ID, false) as never,
    );

    await UserNotificationRuleService.addDefaultNotificationRuleForUser(
      PROJECT_ID,
      USER_ID,
      USER_EMAIL,
    );

    expect(userEmailCreateSpy).not.toHaveBeenCalled();
    expect(createSpy).toHaveBeenCalledTimes(TOTAL_SEEDED_RULES);
    expect(createdRules()[0]!.userEmailId!.toString()).toBe(
      EXISTING_EMAIL_ID.toString(),
    );
  });

  test("the seeded set is identical to the verified-method path", async () => {
    await UserNotificationRuleService.addDefaultNotificationRuleForUser(
      PROJECT_ID,
      USER_ID,
      USER_EMAIL,
    );

    expect(
      createdRules().map((rule: Model): NotificationRuleType => {
        return rule.ruleType!;
      }),
    ).toEqual(SEEDED_RULE_ORDER);
  });
});
