import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import UserEmailService from "../../../Server/Services/UserEmailService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import logger from "../../../Server/Utils/Logger";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A NEW PROJECT'S CREATOR STARTS WITH ONE DEFAULT RULE PER SEVERITY, NOT TWO.
 *
 * Creating a project creates its incident and alert severities, then adds the
 * creator's sign-in email and their default on-call rules: one per severity,
 * on each of the four rule types (ProjectService, through
 * UserNotificationRuleService.addDefaultNotificationRuleForUser). Creating a
 * severity also queues the rule backfill job
 * (BackfillNotificationRulesForNewSeverities), which gives every responder a
 * rule for a severity created after they joined.
 *
 * Both run within the same second. Each checks "is there a rule for this
 * cell?" and then writes one, so when their checks fell between each other's
 * check and write, both wrote: a brand-new project's creator found two
 * identical "Critical Incident: email me immediately" rows on their On-Call
 * Rules page, and once on call was paged twice for every such incident. A
 * walk through sign-up on a local stack found exactly that, on Critical
 * Incident and on both alert episode severities.
 *
 * The job now leaves alone whoever joined the project at or after the
 * severity was created - joining gave them a rule for it - and reads the
 * project's rules before its emails, so a creator whose rules are half
 * written is still known to have joined just now. These tests drive the real
 * job and the real join path over one in-memory rule table.
 */

/*
 * The job registers itself with RunCron when it is imported, which would
 * reach for the Worker queue (and Redis). Mocked before the import.
 */
jest.mock("../../../../App/FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

import {
  backfillSeverity,
  findRecentlyCreatedSeverities,
  hasJoinedSinceSeverity,
  NewSeverity,
  VerifiedEmail,
} from "../../../../App/FeatureSet/Workers/Jobs/OnCallDutyPolicy/BackfillNotificationRulesForNewSeverities";

const PROJECT_ID: ObjectID = new ObjectID(
  "5b000000-0000-4000-8000-000000000001",
);

// The project's creator, and someone who was in the project long before.
const CREATOR_ID: ObjectID = new ObjectID(
  "5b000000-0000-4000-8000-0000000000a1",
);
const CREATOR_EMAIL_ID: ObjectID = new ObjectID(
  "5b000000-0000-4000-8000-0000000000a2",
);
const VETERAN_ID: ObjectID = new ObjectID(
  "5b000000-0000-4000-8000-0000000000b1",
);
const VETERAN_EMAIL_ID: ObjectID = new ObjectID(
  "5b000000-0000-4000-8000-0000000000b2",
);
const VETERAN_SECOND_EMAIL_ID: ObjectID = new ObjectID(
  "5b000000-0000-4000-8000-0000000000b3",
);

const CRITICAL: ObjectID = new ObjectID("5b000000-0000-4000-8000-0000000000c1");
const MAJOR: ObjectID = new ObjectID("5b000000-0000-4000-8000-0000000000c2");
const HIGH: ObjectID = new ObjectID("5b000000-0000-4000-8000-0000000000d1");

/*
 * One moment of the walk that found the duplicates: the severities were
 * created a few hundred milliseconds before the creator's email.
 */
const PROJECT_CREATED_AT: Date = new Date("2026-10-27T18:29:00.700Z");
const SEVERITY_CREATED_AT: Date = new Date("2026-10-27T18:29:00.742Z");
const CREATOR_EMAIL_ADDED_AT: Date = new Date("2026-10-27T18:29:01.097Z");
const VETERAN_JOINED_AT: Date = new Date("2025-03-01T09:00:00.000Z");

interface StoredRule {
  userId: string;
  ruleType: NotificationRuleType;
  incidentSeverityId: string | undefined;
  alertSeverityId: string | undefined;
  method: string;
  notifyAfterMinutes: number | undefined;
}

let ruleTable: Array<UserNotificationRule> = [];
let verifiedEmails: Array<UserEmail> = [];
let reads: Array<string> = [];
let ruleCreateSpy: jest.SpyInstance;

/*
 * Holds the next write until the test lets it through: how a writer that has
 * checked a cell, and is about to write it, is caught mid-way.
 */
let heldWrite: { release: () => void } | null = null;
let shouldHoldNextWrite: boolean = false;

function idOf(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return String(value);
}

const MATCHED_COLUMNS: Array<keyof UserNotificationRule> = [
  "projectId",
  "userId",
  "incidentSeverityId",
  "alertSeverityId",
  "userEmailId",
];

function matches(
  rule: UserNotificationRule,
  query: Record<string, unknown>,
): boolean {
  for (const column of MATCHED_COLUMNS) {
    const expected: string | undefined = idOf(query[column as string]);

    if (expected !== undefined && idOf(rule[column]) !== expected) {
      return false;
    }
  }

  if (query["ruleType"] !== undefined && rule.ruleType !== query["ruleType"]) {
    return false;
  }

  if (
    query["notifyAfterMinutes"] !== undefined &&
    rule.notifyAfterMinutes !== query["notifyAfterMinutes"]
  ) {
    return false;
  }

  return true;
}

function storedRules(): Array<StoredRule> {
  return ruleTable.map((rule: UserNotificationRule): StoredRule => {
    return {
      userId: idOf(rule.userId)!,
      ruleType: rule.ruleType!,
      incidentSeverityId: idOf(rule.incidentSeverityId),
      alertSeverityId: idOf(rule.alertSeverityId),
      method: `email:${idOf(rule.userEmailId)}`,
      notifyAfterMinutes: rule.notifyAfterMinutes,
    };
  });
}

// "userId|ruleType|severity|method|delay" - one cell of a person's rules.
function cellOf(rule: StoredRule): string {
  return [
    rule.userId,
    rule.ruleType,
    rule.incidentSeverityId || rule.alertSeverityId || "-",
    rule.method,
    String(rule.notifyAfterMinutes),
  ].join("|");
}

function duplicatedCells(): Array<string> {
  const seen: Map<string, number> = new Map<string, number>();

  for (const rule of storedRules()) {
    const cell: string = cellOf(rule);
    seen.set(cell, (seen.get(cell) || 0) + 1);
  }

  return Array.from(seen.entries())
    .filter(([, count]: [string, number]): boolean => {
      return count > 1;
    })
    .map(([cell]: [string, number]): string => {
      return cell;
    });
}

function rulesOf(userId: ObjectID): Array<StoredRule> {
  return storedRules().filter((rule: StoredRule): boolean => {
    return rule.userId === userId.toString();
  });
}

function emailRow(data: {
  userId: ObjectID;
  emailId: ObjectID;
  createdAt?: Date | undefined;
}): UserEmail {
  const email: UserEmail = new UserEmail();
  email._id = data.emailId.toString();
  email.userId = data.userId;
  email.projectId = PROJECT_ID;
  email.isVerified = true;

  if (data.createdAt) {
    email.createdAt = data.createdAt;
  }

  return email;
}

function seedRule(data: {
  userId: ObjectID;
  ruleType: NotificationRuleType;
  incidentSeverityId?: ObjectID | undefined;
  alertSeverityId?: ObjectID | undefined;
  userEmailId: ObjectID;
}): void {
  const rule: UserNotificationRule = new UserNotificationRule();
  rule._id = new ObjectID(
    `5b000000-0000-4000-8000-${String(ruleTable.length + 1).padStart(12, "0")}`,
  ).toString();
  rule.projectId = PROJECT_ID;
  rule.userId = data.userId;
  rule.ruleType = data.ruleType;
  rule.notifyAfterMinutes = 0;
  rule.userEmailId = data.userEmailId;

  if (data.incidentSeverityId) {
    rule.incidentSeverityId = data.incidentSeverityId;
  }

  if (data.alertSeverityId) {
    rule.alertSeverityId = data.alertSeverityId;
  }

  ruleTable.push(rule);
}

// null: a severity the sweep could not read the creation time of.
function incidentSeverity(
  id: ObjectID,
  createdAt: Date | null = SEVERITY_CREATED_AT,
): NewSeverity {
  return {
    id: id,
    projectId: PROJECT_ID,
    kind: "incident",
    createdAt: createdAt || undefined,
  };
}

function alertSeverity(
  id: ObjectID,
  createdAt: Date | null = SEVERITY_CREATED_AT,
): NewSeverity {
  return {
    id: id,
    projectId: PROJECT_ID,
    kind: "alert",
    createdAt: createdAt || undefined,
  };
}

// Lets every pending promise callback run, a few times over.
async function settle(): Promise<void> {
  for (let tick: number = 0; tick < 10; tick++) {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  }
}

// What ProjectService runs for the creator, once the email is added.
function runCreatorJoin(): Promise<void> {
  return UserNotificationRuleService.addDefaultNotificationRulesForVerifiedMethod(
    {
      projectId: PROJECT_ID,
      userId: CREATOR_ID,
      notificationMethod: {
        userEmailId: CREATOR_EMAIL_ID,
      },
    },
  );
}

beforeEach(() => {
  ruleTable = [];
  verifiedEmails = [];
  reads = [];
  heldWrite = null;
  shouldHoldNextWrite = false;

  jest
    .spyOn(UserNotificationRuleService, "findAllBy")
    .mockImplementation(((data: {
      query: Record<string, unknown>;
    }): Promise<Array<UserNotificationRule>> => {
      reads.push(`rules:${String(data.query["ruleType"])}`);

      return Promise.resolve(
        ruleTable.filter((rule: UserNotificationRule): boolean => {
          return matches(rule, data.query);
        }),
      );
    }) as never);

  jest
    .spyOn(UserNotificationRuleService, "findOneBy")
    .mockImplementation(((data: {
      query: Record<string, unknown>;
    }): Promise<UserNotificationRule | null> => {
      return Promise.resolve(
        ruleTable.find((rule: UserNotificationRule): boolean => {
          return matches(rule, data.query);
        }) || null,
      );
    }) as never);

  ruleCreateSpy = jest
    .spyOn(UserNotificationRuleService, "create")
    .mockImplementation((async (data: {
      data: UserNotificationRule;
    }): Promise<UserNotificationRule> => {
      if (shouldHoldNextWrite) {
        shouldHoldNextWrite = false;

        await new Promise<void>((resolve: () => void): void => {
          heldWrite = { release: resolve };
        });
      }

      const rule: UserNotificationRule = data.data;
      rule._id = new ObjectID(
        `5b000000-0000-4000-8000-${String(ruleTable.length + 1).padStart(12, "0")}`,
      ).toString();
      ruleTable.push(rule);

      return rule;
    }) as never);

  jest.spyOn(UserEmailService, "findAllBy").mockImplementation(((): Promise<
    Array<UserEmail>
  > => {
    reads.push("verified emails");

    return Promise.resolve(verifiedEmails);
  }) as never);

  // The severities the join path finds: what the project was created with.
  jest.spyOn(IncidentSeverityService, "findBy").mockImplementation(((): Promise<
    Array<IncidentSeverity>
  > => {
    return Promise.resolve(
      [CRITICAL, MAJOR].map((id: ObjectID): IncidentSeverity => {
        const severity: IncidentSeverity = new IncidentSeverity();
        severity._id = id.toString();
        severity.projectId = PROJECT_ID;
        return severity;
      }),
    );
  }) as never);

  jest.spyOn(AlertSeverityService, "findBy").mockImplementation(((): Promise<
    Array<AlertSeverity>
  > => {
    const severity: AlertSeverity = new AlertSeverity();
    severity._id = HIGH.toString();
    severity.projectId = PROJECT_ID;
    return Promise.resolve([severity]);
  }) as never);

  jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("hasJoinedSinceSeverity", () => {
  function verified(joinedAt: Date | undefined): VerifiedEmail {
    return { emailId: CREATOR_EMAIL_ID, joinedAt: joinedAt };
  }

  test("someone whose email was added after the severity joined since", () => {
    expect(
      hasJoinedSinceSeverity({
        severity: incidentSeverity(CRITICAL),
        verifiedEmail: verified(CREATOR_EMAIL_ADDED_AT),
      }),
    ).toBe(true);
  });

  test("the very same moment counts as joined since: joining read the severity", () => {
    expect(
      hasJoinedSinceSeverity({
        severity: incidentSeverity(CRITICAL),
        verifiedEmail: verified(new Date(SEVERITY_CREATED_AT.getTime())),
      }),
    ).toBe(true);
  });

  test("someone who was in the project before the severity did not", () => {
    expect(
      hasJoinedSinceSeverity({
        severity: incidentSeverity(CRITICAL),
        verifiedEmail: verified(VETERAN_JOINED_AT),
      }),
    ).toBe(false);
  });

  test("a millisecond before the severity is before it", () => {
    expect(
      hasJoinedSinceSeverity({
        severity: incidentSeverity(CRITICAL),
        verifiedEmail: verified(new Date(SEVERITY_CREATED_AT.getTime() - 1)),
      }),
    ).toBe(false);
  });

  test("a time it does not know skips nobody", () => {
    expect(
      hasJoinedSinceSeverity({
        severity: incidentSeverity(CRITICAL, null),
        verifiedEmail: verified(CREATOR_EMAIL_ADDED_AT),
      }),
    ).toBe(false);
    expect(
      hasJoinedSinceSeverity({
        severity: incidentSeverity(CRITICAL),
        verifiedEmail: verified(undefined),
      }),
    ).toBe(false);
    expect(
      hasJoinedSinceSeverity({
        severity: incidentSeverity(CRITICAL),
        verifiedEmail: undefined,
      }),
    ).toBe(false);
  });

  test("times read back from the database as text compare as times", () => {
    expect(
      hasJoinedSinceSeverity({
        severity: {
          ...incidentSeverity(CRITICAL),
          createdAt: "2026-10-27T18:29:00.742Z" as unknown as Date,
        },
        verifiedEmail: {
          emailId: CREATOR_EMAIL_ID,
          joinedAt: "2026-10-27T18:29:01.097Z" as unknown as Date,
        },
      }),
    ).toBe(true);
  });
});

describe("the backfill leaves alone whoever joined after the severity", () => {
  test("the new project's creator, before the join path has written anything", async () => {
    verifiedEmails = [
      emailRow({
        userId: CREATOR_ID,
        emailId: CREATOR_EMAIL_ID,
        createdAt: CREATOR_EMAIL_ADDED_AT,
      }),
    ];

    await backfillSeverity(incidentSeverity(CRITICAL));

    expect(ruleCreateSpy).not.toHaveBeenCalled();
    expect(rulesOf(CREATOR_ID)).toEqual([]);
  });

  test("the creator whose rules for the other severities are already written", async () => {
    verifiedEmails = [
      emailRow({
        userId: CREATOR_ID,
        emailId: CREATOR_EMAIL_ID,
        createdAt: CREATOR_EMAIL_ADDED_AT,
      }),
    ];

    // The join path got as far as Major, and is about to write Critical.
    seedRule({
      userId: CREATOR_ID,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      incidentSeverityId: MAJOR,
      userEmailId: CREATOR_EMAIL_ID,
    });
    seedRule({
      userId: CREATOR_ID,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
      incidentSeverityId: MAJOR,
      userEmailId: CREATOR_EMAIL_ID,
    });

    await backfillSeverity(incidentSeverity(CRITICAL));

    // Nothing mirrored from Major onto Critical: the join path writes it.
    expect(ruleCreateSpy).not.toHaveBeenCalled();
  });

  test("an alert severity the same way", async () => {
    verifiedEmails = [
      emailRow({
        userId: CREATOR_ID,
        emailId: CREATOR_EMAIL_ID,
        createdAt: CREATOR_EMAIL_ADDED_AT,
      }),
    ];

    await backfillSeverity(alertSeverity(HIGH));

    expect(ruleCreateSpy).not.toHaveBeenCalled();
  });

  test("while someone who was there before the severity still gets a rule for it", async () => {
    verifiedEmails = [
      emailRow({
        userId: VETERAN_ID,
        emailId: VETERAN_EMAIL_ID,
        createdAt: VETERAN_JOINED_AT,
      }),
      emailRow({
        userId: CREATOR_ID,
        emailId: CREATOR_EMAIL_ID,
        createdAt: CREATOR_EMAIL_ADDED_AT,
      }),
    ];

    await backfillSeverity(incidentSeverity(CRITICAL));

    expect(rulesOf(CREATOR_ID)).toEqual([]);
    expect(
      rulesOf(VETERAN_ID).map((rule: StoredRule): string => {
        return `${rule.ruleType} ${rule.incidentSeverityId} ${rule.method}`;
      }),
    ).toEqual([
      `${NotificationRuleType.ON_CALL_EXECUTED_INCIDENT} ${CRITICAL.toString()} email:${VETERAN_EMAIL_ID.toString()}`,
      `${NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE} ${CRITICAL.toString()} email:${VETERAN_EMAIL_ID.toString()}`,
    ]);
  });

  test("and the rules they chose are still mirrored onto it", async () => {
    verifiedEmails = [
      emailRow({
        userId: VETERAN_ID,
        emailId: VETERAN_EMAIL_ID,
        createdAt: VETERAN_JOINED_AT,
      }),
    ];

    seedRule({
      userId: VETERAN_ID,
      ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
      incidentSeverityId: MAJOR,
      userEmailId: VETERAN_EMAIL_ID,
    });

    await backfillSeverity(incidentSeverity(CRITICAL));

    expect(
      rulesOf(VETERAN_ID).filter((rule: StoredRule): boolean => {
        return (
          rule.ruleType === NotificationRuleType.ON_CALL_EXECUTED_INCIDENT &&
          rule.incidentSeverityId === CRITICAL.toString()
        );
      }),
    ).toHaveLength(1);
  });

  test("someone joined when the first of their addresses was added, not a later one", async () => {
    verifiedEmails = [
      // A second address, added after the severity...
      emailRow({
        userId: VETERAN_ID,
        emailId: VETERAN_SECOND_EMAIL_ID,
        createdAt: CREATOR_EMAIL_ADDED_AT,
      }),
      // ...by someone who was there long before it.
      emailRow({
        userId: VETERAN_ID,
        emailId: VETERAN_EMAIL_ID,
        createdAt: VETERAN_JOINED_AT,
      }),
    ];

    await backfillSeverity(incidentSeverity(CRITICAL));

    // Still covered, on the first address the read returned, as before.
    expect(rulesOf(VETERAN_ID)).toHaveLength(2);
    expect(
      rulesOf(VETERAN_ID).every((rule: StoredRule): boolean => {
        return rule.method === `email:${VETERAN_SECOND_EMAIL_ID.toString()}`;
      }),
    ).toBe(true);
  });

  test("with no times to go by, it covers everyone, as it always did", async () => {
    verifiedEmails = [
      emailRow({ userId: CREATOR_ID, emailId: CREATOR_EMAIL_ID }),
    ];

    await backfillSeverity(incidentSeverity(CRITICAL, null));

    expect(rulesOf(CREATOR_ID)).toHaveLength(2);
  });

  test("the rules are read before the emails, so a half-written join is never mistaken for a veteran", async () => {
    await backfillSeverity(incidentSeverity(CRITICAL));

    expect(reads).toEqual([
      `rules:${NotificationRuleType.ON_CALL_EXECUTED_INCIDENT}`,
      `rules:${NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE}`,
      "verified emails",
    ]);
  });

  test("the emails are read with the time each was added", async () => {
    const emailRead: jest.SpyInstance = UserEmailService.findAllBy as never;

    await backfillSeverity(incidentSeverity(CRITICAL));

    const select: Record<string, unknown> = (
      emailRead.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;

    expect(select["createdAt"]).toBe(true);
    expect(select["userId"]).toBe(true);
  });
});

describe("the severities the sweep finds carry when they were created", () => {
  test("both tables are read with createdAt, and it is handed on", async () => {
    const incidentRow: IncidentSeverity = new IncidentSeverity();
    incidentRow._id = CRITICAL.toString();
    incidentRow.projectId = PROJECT_ID;
    incidentRow.createdAt = SEVERITY_CREATED_AT;

    const alertRow: AlertSeverity = new AlertSeverity();
    alertRow._id = HIGH.toString();
    alertRow.projectId = PROJECT_ID;
    alertRow.createdAt = PROJECT_CREATED_AT;

    const incidentRead: jest.SpyInstance = jest
      .spyOn(IncidentSeverityService, "findAllBy")
      .mockResolvedValue([incidentRow] as never);
    const alertRead: jest.SpyInstance = jest
      .spyOn(AlertSeverityService, "findAllBy")
      .mockResolvedValue([alertRow] as never);

    const severities: Array<NewSeverity> =
      await findRecentlyCreatedSeverities();

    for (const read of [incidentRead, alertRead]) {
      const select: Record<string, unknown> = (
        read.mock.calls[0]![0] as { select: Record<string, unknown> }
      ).select;

      expect(select["createdAt"]).toBe(true);
    }

    expect(
      severities.map((severity: NewSeverity): string => {
        return `${severity.kind} ${severity.createdAt?.toISOString()}`;
      }),
    ).toEqual([
      `incident ${SEVERITY_CREATED_AT.toISOString()}`,
      `alert ${PROJECT_CREATED_AT.toISOString()}`,
    ]);
  });
});

describe("the race a new project's creator lost", () => {
  /*
   * The join path checks Critical's cell, finds it empty and is about to
   * write it; the backfill job, queued when Critical was created, runs in
   * between. Held at exactly that moment, the two used to write the same
   * rule twice.
   */
  async function raceJoinAgainstBackfill(
    creatorEmail: UserEmail,
  ): Promise<void> {
    verifiedEmails = [creatorEmail];
    shouldHoldNextWrite = true;

    const join: Promise<void> = runCreatorJoin();

    // The join path has checked its first cell and is writing it.
    await settle();
    expect(heldWrite).not.toBeNull();

    await backfillSeverity(incidentSeverity(CRITICAL));
    await backfillSeverity(alertSeverity(HIGH));

    heldWrite!.release();
    await join;
  }

  test("the creator ends with exactly one rule per severity and rule type", async () => {
    await raceJoinAgainstBackfill(
      emailRow({
        userId: CREATOR_ID,
        emailId: CREATOR_EMAIL_ID,
        createdAt: CREATOR_EMAIL_ADDED_AT,
      }),
    );

    expect(duplicatedCells()).toEqual([]);

    /*
     * Two incident severities and one alert severity, four rule types, and
     * the two shift rules.
     */
    expect(rulesOf(CREATOR_ID)).toHaveLength(2 * 2 + 1 * 2 + 2);
  });

  test("without a join time to go by, the same race writes a rule twice (the harness reproduces it)", async () => {
    await raceJoinAgainstBackfill(
      emailRow({ userId: CREATOR_ID, emailId: CREATOR_EMAIL_ID }),
    );

    expect(duplicatedCells()).toEqual([
      [
        CREATOR_ID.toString(),
        NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        CRITICAL.toString(),
        `email:${CREATOR_EMAIL_ID.toString()}`,
        "0",
      ].join("|"),
    ]);
  });

  test("a second sweep afterwards writes nothing either", async () => {
    await raceJoinAgainstBackfill(
      emailRow({
        userId: CREATOR_ID,
        emailId: CREATOR_EMAIL_ID,
        createdAt: CREATOR_EMAIL_ADDED_AT,
      }),
    );

    const rulesAfterRace: number = ruleTable.length;

    await backfillSeverity(incidentSeverity(CRITICAL));
    await backfillSeverity(incidentSeverity(MAJOR));
    await backfillSeverity(alertSeverity(HIGH));

    expect(ruleTable).toHaveLength(rulesAfterRace);
    expect(duplicatedCells()).toEqual([]);
  });
});
