import SecurityCaseFeedService from "../../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import { securityCaseGroupingKey } from "../../../../Server/Utils/SecurityCase/SecurityCaseIngest";
import SecurityCaseNotifications from "../../../../Server/Utils/SecurityCase/SecurityCaseNotifications";
import SecurityCaseTargetCheck, {
  SECURITY_CASE_TARGET_CHECK_BATCH_SIZE,
  SECURITY_CASE_TARGET_CHECK_MAX_BATCHES,
  SecurityCaseTargetCheckResult,
  getTargetCheckResult,
} from "../../../../Server/Utils/SecurityCase/SecurityCaseTargetCheck";
import SecurityCaseValues from "../../../../Server/Utils/SecurityCase/SecurityCaseValues";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import { SecurityCaseFeedEventType } from "../../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityCasePriority from "../../../../Models/DatabaseModels/SecurityCasePriority";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import { Red500, Yellow500 } from "../../../../Types/BrandColors";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import SecurityCasePriorityLevel from "../../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../../Types/SecurityCase/SecurityCaseStage";
import { SETUP_TEST_SOURCE_IP } from "../../../../Types/SecurityEvent/SecuritySetupTest";
import * as SecurityCaseTargets from "../../../../Utils/SecurityCase/SecurityCaseTargets";
import {
  SecurityCaseTarget,
  SecurityCaseTargetAlert,
  SecurityCaseTargetAlertKind,
} from "../../../../Utils/SecurityCase/SecurityCaseTargets";
import {
  buildDefaultTestPrioritiesWithTargets,
  testPriorityId,
  testStatusId,
} from "../../../Helpers/SecurityCaseValues";
import { stubSecurityCaseValues } from "../../../Helpers/SecurityCaseValuesStub";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The every-minute check of security cases' response targets
 * (SecurityCaseTargetCheck): which cases it reads, what it says about each,
 * that each thing is said once - also when two workers are handed the same
 * case - and that a case is next looked at exactly when its next target
 * moment comes.
 *
 * A Critical case of a new project: acknowledge within 15 minutes (at risk
 * from minute 12), contain within 4 hours (at risk from minute 192).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const NOW: Date = new Date("2026-10-14T12:00:00.000Z");
const MINUTE: number = 60 * 1000;

// What QueryHelper.lessThanEqualTo hands the database layer.
interface RawOperator {
  _getSql: (alias: string) => string;
  _objectLiteralParameters: Record<string, unknown>;
}

function at(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * MINUTE);
}

function caseId(index: number): ObjectID {
  return new ObjectID(
    `cccccccc-cccc-4ccc-8ccc-${String(index).padStart(12, "0")}`,
  );
}

// As the case's service left it when it opened at NOW.
function caseModel(overrides: Partial<SecurityCase> = {}): SecurityCase {
  const model: SecurityCase = new SecurityCase();
  model._id = CASE_ID.toString();
  model.projectId = PROJECT_ID;
  model.securityCasePriorityId = testPriorityId(
    SecurityCasePriorityLevel.Critical,
  );
  model.securityCaseStatusId = testStatusId(SecurityCaseStage.New);
  model.groupingKey = "entity:198.51.100.7";
  model.createdAt = NOW;
  model.acknowledgeDueAt = at(15);
  model.containDueAt = at(240);
  model.nextDueAt = at(15);
  model.nextTargetCheckAt = at(12);
  Object.assign(model, overrides);
  return model;
}

// The case as one read of it found it: what each worker holds.
function readOf(securityCase: SecurityCase): SecurityCase {
  const copy: SecurityCase = new SecurityCase();
  Object.assign(copy, securityCase);
  return copy;
}

const priorities: Array<SecurityCasePriority> =
  buildDefaultTestPrioritiesWithTargets();

function priority(level: SecurityCasePriorityLevel): SecurityCasePriority {
  return priorities.find((row: SecurityCasePriority): boolean => {
    return row.id!.equals(testPriorityId(level));
  })!;
}

// The rows as the database holds them, by id.
let held: Map<string, SecurityCase>;
let writes: Array<{ id: string; data: JSONObject; expectedData: JSONObject }>;
let feedItems: Array<JSONObject>;
let alertsQueued: Array<JSONObject>;
let failWritesOf: Set<string>;

function hold(securityCase: SecurityCase): SecurityCase {
  held.set(securityCase.id!.toString(), securityCase);
  return securityCase;
}

function sameMoment(left: unknown, right: unknown): boolean {
  const toTime: (value: unknown) => number | null = (
    value: unknown,
  ): number | null => {
    return value ? new Date(value as Date).getTime() : null;
  };

  return toTime(left) === toTime(right);
}

beforeEach(() => {
  stubSecurityCaseValues({ priorities });
  held = new Map();
  writes = [];
  feedItems = [];
  alertsQueued = [];
  failWritesOf = new Set();

  jest
    .spyOn(SecurityCaseService, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation(async (args: unknown): Promise<boolean> => {
      const { id, data, expectedData, skipUpdateDateColumn } = args as {
        id: ObjectID;
        data: JSONObject;
        expectedData: JSONObject;
        skipUpdateDateColumn: boolean;
      };

      if (failWritesOf.has(id.toString())) {
        throw new Error("The database went away.");
      }

      // A target's bookkeeping never moves the case's Updated time.
      expect(skipUpdateDateColumn).toBe(true);

      writes.push({ id: id.toString(), data, expectedData });

      const row: SecurityCase | undefined = held.get(id.toString());

      if (!row) {
        return true;
      }

      if (
        !sameMoment(row.nextTargetCheckAt, expectedData["nextTargetCheckAt"])
      ) {
        return false;
      }

      Object.assign(row, data);
      return true;
    });

  jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockImplementation(async (args: unknown) => {
      feedItems.push(args as JSONObject);
      return undefined as never;
    });

  jest
    .spyOn(SecurityCaseNotifications, "targetAlert")
    .mockImplementation(async (args: unknown): Promise<void> => {
      alertsQueued.push(args as JSONObject);
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function check(
  securityCase: SecurityCase,
  now: Date,
  extra: Partial<Parameters<typeof getTargetCheckResult>[0]> = {},
): SecurityCaseTargetCheckResult {
  return getTargetCheckResult({
    securityCase,
    priority: priority(SecurityCasePriorityLevel.Critical),
    isClosed: false,
    now,
    ...extra,
  });
}

describe("what one look at a case finds", () => {
  test("before the acknowledge target's last fifth: nothing to say, and looked at again when it starts", () => {
    expect(check(caseModel(), at(5))).toEqual({
      alerts: [],
      write: { nextDueAt: at(15), nextTargetCheckAt: at(12) },
    });
  });

  test("in its last fifth: warned once, then looked at again when it is due", () => {
    expect(check(caseModel(), at(12))).toEqual({
      alerts: [
        {
          target: SecurityCaseTarget.Acknowledge,
          kind: SecurityCaseTargetAlertKind.AtRisk,
          dueAt: at(15),
          targetInMinutes: 15,
        },
      ],
      write: {
        acknowledgeWarnedAt: at(12),
        nextDueAt: at(15),
        nextTargetCheckAt: at(15),
      },
    });
  });

  test("past it: missed - still the case's next due time - and looked at again in the contain target's last fifth", () => {
    expect(check(caseModel({ acknowledgeWarnedAt: at(12) }), at(15))).toEqual({
      alerts: [
        {
          target: SecurityCaseTarget.Acknowledge,
          kind: SecurityCaseTargetAlertKind.Missed,
          dueAt: at(15),
          targetInMinutes: 15,
        },
      ],
      write: {
        acknowledgeMissedAt: at(15),
        nextDueAt: at(15),
        nextTargetCheckAt: at(192),
      },
    });
  });

  test("first looked at after its due time: missed, never a warning that comes too late", () => {
    const result: SecurityCaseTargetCheckResult = check(caseModel(), at(20));

    expect(
      result.alerts.map((alert: SecurityCaseTargetAlert): string => {
        return `${alert.target} ${alert.kind}`;
      }),
    ).toEqual(["Acknowledge Missed"]);
    expect(result.write).not.toHaveProperty("acknowledgeWarnedAt");
    expect(result.write["acknowledgeMissedAt"]).toEqual(at(20));
  });

  test("after a long outage, both targets missed at once, and nothing left to look at", () => {
    expect(check(caseModel(), at(300))).toEqual({
      alerts: [
        {
          target: SecurityCaseTarget.Acknowledge,
          kind: SecurityCaseTargetAlertKind.Missed,
          dueAt: at(15),
          targetInMinutes: 15,
        },
        {
          target: SecurityCaseTarget.Contain,
          kind: SecurityCaseTargetAlertKind.Missed,
          dueAt: at(240),
          targetInMinutes: 240,
        },
      ],
      write: {
        acknowledgeMissedAt: at(300),
        containMissedAt: at(300),
        nextDueAt: at(15),
        nextTargetCheckAt: null,
      },
    });
  });

  test("taken on in time: only the contain target is left, and it is the next due time", () => {
    expect(check(caseModel({ acknowledgedAt: at(5) }), at(192))).toEqual({
      alerts: [
        {
          target: SecurityCaseTarget.Contain,
          kind: SecurityCaseTargetAlertKind.AtRisk,
          dueAt: at(240),
          targetInMinutes: 240,
        },
      ],
      write: {
        containWarnedAt: at(192),
        nextDueAt: at(240),
        nextTargetCheckAt: at(240),
      },
    });
  });

  test("contained in time: both met, nothing left to say or to look at", () => {
    expect(
      check(caseModel({ acknowledgedAt: at(5), containedAt: at(30) }), at(31)),
    ).toEqual({
      alerts: [],
      write: { nextDueAt: null, nextTargetCheckAt: null },
    });
  });

  test("a closed case says nothing and is looked at no more, missed or not", () => {
    expect(check(caseModel(), at(20), { isClosed: true })).toEqual({
      alerts: [],
      write: { nextDueAt: null, nextTargetCheckAt: null },
    });
  });

  test("the setup test's case says nothing and is looked at no more", () => {
    expect(
      check(
        caseModel({
          groupingKey: securityCaseGroupingKey({
            groupValue: SETUP_TEST_SOURCE_IP,
            fingerprint: "",
          }),
        }),
        at(20),
      ),
    ).toEqual({
      alerts: [],
      write: { nextDueAt: null, nextTargetCheckAt: null },
    });
  });

  test("a priority without targets any more: no last fifth to warn in, only the due time it holds", () => {
    const informational: SecurityCasePriority = priority(
      SecurityCasePriorityLevel.Informational,
    );

    expect(check(caseModel(), at(12), { priority: informational })).toEqual({
      alerts: [],
      write: { nextDueAt: at(15), nextTargetCheckAt: at(15) },
    });
    expect(
      check(caseModel(), at(15), { priority: informational }).alerts,
    ).toEqual([
      {
        target: SecurityCaseTarget.Acknowledge,
        kind: SecurityCaseTargetAlertKind.Missed,
        dueAt: at(15),
        targetInMinutes: null,
      },
    ]);
  });

  test("a next check that would not move past now is put a minute on: never read again and again in one run", () => {
    jest.spyOn(SecurityCaseTargets, "getTargetBookkeeping").mockReturnValue({
      nextDueAt: at(15),
      nextTargetCheckAt: at(10),
    });

    expect(check(caseModel(), at(12)).write["nextTargetCheckAt"]).toEqual(
      at(13),
    );
  });
});

describe("one case", () => {
  test("warned: stamped with its next check in one compare-and-set on the check time it was read with, then on its timeline and to its people", async () => {
    const securityCase: SecurityCase = hold(caseModel());

    const alerts: Array<SecurityCaseTargetAlert> =
      await SecurityCaseTargetCheck.checkCase({
        securityCase: readOf(securityCase),
        now: at(12),
      });

    expect(alerts).toHaveLength(1);
    expect(writes).toEqual([
      {
        id: CASE_ID.toString(),
        data: {
          acknowledgeWarnedAt: at(12),
          nextDueAt: at(15),
          nextTargetCheckAt: at(15),
        },
        expectedData: { nextTargetCheckAt: at(12) },
      },
    ]);
    expect(feedItems).toEqual([
      {
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        feedInfoInMarkdown:
          "⏰ About to miss its **acknowledge** target of 15 minutes: 3 minutes left.",
        eventType: SecurityCaseFeedEventType.ResponseTarget,
        displayColor: Yellow500,
        postedAt: at(12),
      },
    ]);
    expect(alertsQueued).toEqual([
      {
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        target: SecurityCaseTarget.Acknowledge,
        alertKind: SecurityCaseTargetAlertKind.AtRisk,
      },
    ]);
  });

  test("missed: in red on its timeline, and its people told", async () => {
    const securityCase: SecurityCase = hold(
      caseModel({ acknowledgeWarnedAt: at(12), nextTargetCheckAt: at(15) }),
    );

    await SecurityCaseTargetCheck.checkCase({
      securityCase: readOf(securityCase),
      now: at(15),
    });

    expect(feedItems).toHaveLength(1);
    expect(feedItems[0]!["feedInfoInMarkdown"]).toBe(
      "🚨 Missed its **acknowledge** target of 15 minutes.",
    );
    expect(feedItems[0]!["displayColor"]).toEqual(Red500);
    expect(alertsQueued).toEqual([
      {
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        target: SecurityCaseTarget.Acknowledge,
        alertKind: SecurityCaseTargetAlertKind.Missed,
      },
    ]);
    expect(securityCase.acknowledgeMissedAt).toEqual(at(15));
    expect(securityCase.nextTargetCheckAt).toEqual(at(192));
  });

  test("two workers handed the same case: one says it, the other finds its moment moved and says nothing", async () => {
    const securityCase: SecurityCase = hold(caseModel());
    const firstRead: SecurityCase = readOf(securityCase);
    const secondRead: SecurityCase = readOf(securityCase);

    await SecurityCaseTargetCheck.checkCase({
      securityCase: firstRead,
      now: at(12),
    });
    const late: Array<SecurityCaseTargetAlert> =
      await SecurityCaseTargetCheck.checkCase({
        securityCase: secondRead,
        now: at(12),
      });

    expect(late).toEqual([]);
    expect(writes).toHaveLength(2);
    expect(feedItems).toHaveLength(1);
    expect(alertsQueued).toHaveLength(1);
  });

  test("the same moment looked at again a minute later says nothing more", async () => {
    const securityCase: SecurityCase = hold(caseModel());

    await SecurityCaseTargetCheck.checkCase({
      securityCase: readOf(securityCase),
      now: at(12),
    });
    await SecurityCaseTargetCheck.checkCase({
      securityCase: readOf(securityCase),
      now: at(13),
    });

    expect(feedItems).toHaveLength(1);
    expect(alertsQueued).toHaveLength(1);
  });

  test("in a closed status, though nothing stamped it closed: its check time cleared, nothing said", async () => {
    const securityCase: SecurityCase = hold(
      caseModel({
        securityCaseStatusId: testStatusId(SecurityCaseStage.Closed),
      }),
    );

    expect(
      await SecurityCaseTargetCheck.checkCase({
        securityCase: readOf(securityCase),
        now: at(20),
      }),
    ).toEqual([]);
    expect(writes[0]!.data).toEqual({
      nextDueAt: null,
      nextTargetCheckAt: null,
    });
    expect(feedItems).toEqual([]);
    expect(alertsQueued).toEqual([]);
  });

  test("closed, by its closed time: the same", async () => {
    const securityCase: SecurityCase = hold(caseModel({ closedAt: at(3) }));

    await SecurityCaseTargetCheck.checkCase({
      securityCase: readOf(securityCase),
      now: at(20),
    });

    expect(writes[0]!.data).toEqual({
      nextDueAt: null,
      nextTargetCheckAt: null,
    });
    expect(alertsQueued).toEqual([]);
  });

  test("a priority without a target any more: missed, without saying how long the target was", async () => {
    const securityCase: SecurityCase = hold(
      caseModel({
        securityCasePriorityId: testPriorityId(
          SecurityCasePriorityLevel.Informational,
        ),
        nextTargetCheckAt: at(15),
      }),
    );

    await SecurityCaseTargetCheck.checkCase({
      securityCase: readOf(securityCase),
      now: at(15),
    });

    expect(feedItems[0]!["feedInfoInMarkdown"]).toBe(
      "🚨 Missed its **acknowledge** target.",
    );
  });

  test("a read without its id or project is left alone", async () => {
    const securityCase: SecurityCase = caseModel();
    securityCase.projectId = undefined as never;

    expect(
      await SecurityCaseTargetCheck.checkCase({
        securityCase,
        now: at(12),
      }),
    ).toEqual([]);
    expect(writes).toEqual([]);
  });
});

describe("every minute", () => {
  let batches: Array<Array<SecurityCase>>;
  let reads: Array<JSONObject>;

  beforeEach(() => {
    batches = [];
    reads = [];

    jest
      .spyOn(SecurityCaseService, "findBy")
      .mockImplementation(async (args: unknown) => {
        reads.push(args as JSONObject);
        return (batches.shift() || []) as never;
      });
  });

  function cases(from: number, count: number): Array<SecurityCase> {
    return Array.from({ length: count }, (_: unknown, index: number) => {
      return caseModel({ _id: caseId(from + index).toString() });
    });
  }

  test("reads the cases whose moment has come, the oldest first, a batch at a time, and looks at each", async () => {
    batches = [cases(1, 3)];

    expect(await SecurityCaseTargetCheck.checkDueCases(at(12))).toBe(3);

    expect(reads).toHaveLength(1);
    // nextTargetCheckAt <= now: the cases whose moment has come.
    const query: JSONObject = reads[0]!["query"] as JSONObject;
    expect(Object.keys(query)).toEqual(["nextTargetCheckAt"]);
    const operator: RawOperator = query[
      "nextTargetCheckAt"
    ] as unknown as RawOperator;
    expect(operator._getSql('"SecurityCase"."nextTargetCheckAt"')).toMatch(
      /^\("SecurityCase"\."nextTargetCheckAt" <= :\w+\)$/,
    );
    expect(Object.values(operator._objectLiteralParameters)).toEqual([at(12)]);
    expect(reads[0]!["sort"]).toEqual({
      nextTargetCheckAt: SortOrder.Ascending,
    });
    expect(reads[0]!["skip"]).toBe(0);
    expect(reads[0]!["limit"]).toBe(SECURITY_CASE_TARGET_CHECK_BATCH_SIZE);
    expect(reads[0]!["props"]).toEqual({ isRoot: true });
    // Everything the rules read of a case.
    expect(Object.keys(reads[0]!["select"] as JSONObject).sort()).toEqual(
      [
        "_id",
        "projectId",
        "groupingKey",
        "securityCaseStatusId",
        "securityCasePriorityId",
        "createdAt",
        "acknowledgedAt",
        "containedAt",
        "closedAt",
        "acknowledgeDueAt",
        "containDueAt",
        "acknowledgeWarnedAt",
        "acknowledgeMissedAt",
        "containWarnedAt",
        "containMissedAt",
        "nextDueAt",
        "nextTargetCheckAt",
      ].sort(),
    );
    expect(alertsQueued).toHaveLength(3);
  });

  test("a full batch is followed by another; a case already looked at this run is not looked at again", async () => {
    batches = [
      cases(1, SECURITY_CASE_TARGET_CHECK_BATCH_SIZE),
      // Thirty held by another worker come back, with seventy new ones.
      [...cases(1, 30), ...cases(1001, 70)],
    ];

    expect(await SecurityCaseTargetCheck.checkDueCases(at(12))).toBe(170);
    expect(reads).toHaveLength(3);
    expect(writes).toHaveLength(170);
  });

  test("a batch of cases all looked at already ends the run", async () => {
    batches = [
      cases(1, SECURITY_CASE_TARGET_CHECK_BATCH_SIZE),
      cases(1, SECURITY_CASE_TARGET_CHECK_BATCH_SIZE),
    ];

    expect(await SecurityCaseTargetCheck.checkDueCases(at(12))).toBe(
      SECURITY_CASE_TARGET_CHECK_BATCH_SIZE,
    );
    expect(reads).toHaveLength(2);
  });

  test("at most 2,000 cases a run: the rest wait for the next minute", async () => {
    batches = Array.from(
      { length: SECURITY_CASE_TARGET_CHECK_MAX_BATCHES + 5 },
      (_: unknown, batch: number) => {
        return cases(
          batch * SECURITY_CASE_TARGET_CHECK_BATCH_SIZE + 1,
          SECURITY_CASE_TARGET_CHECK_BATCH_SIZE,
        );
      },
    );

    expect(await SecurityCaseTargetCheck.checkDueCases(at(12))).toBe(2000);
    expect(reads).toHaveLength(SECURITY_CASE_TARGET_CHECK_MAX_BATCHES);
  });

  test("one case that cannot be checked is not the others'", async () => {
    batches = [cases(1, 3)];
    failWritesOf.add(caseId(2).toString());

    expect(await SecurityCaseTargetCheck.checkDueCases(at(12))).toBe(3);
    expect(
      alertsQueued.map((alert: JSONObject): string => {
        return String(alert["securityCaseId"]);
      }),
    ).toEqual([caseId(1).toString(), caseId(3).toString()]);
  });

  test("each project's priorities and statuses are read once a run", async () => {
    const getForProject: ReturnType<typeof jest.spyOn> = jest.spyOn(
      SecurityCaseValues,
      "getForProject",
    );
    batches = [
      [
        ...cases(1, 3),
        caseModel({
          _id: caseId(4).toString(),
          projectId: OTHER_PROJECT_ID,
        }),
      ],
    ];

    await SecurityCaseTargetCheck.checkDueCases(at(12));

    expect(getForProject).toHaveBeenCalledTimes(2);
  });

  test("nothing due: one read, nothing written", async () => {
    expect(await SecurityCaseTargetCheck.checkDueCases(at(12))).toBe(0);
    expect(reads).toHaveLength(1);
    expect(writes).toEqual([]);
  });
});
