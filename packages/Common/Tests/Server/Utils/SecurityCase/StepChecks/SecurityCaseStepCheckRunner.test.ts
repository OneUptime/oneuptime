import Project from "../../../../../Models/DatabaseModels/Project";
import SecurityCase from "../../../../../Models/DatabaseModels/SecurityCase";
import { SecurityCaseFeedEventType } from "../../../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityCaseStepCheck from "../../../../../Models/DatabaseModels/SecurityCaseStepCheck";
import SecurityCaseTask from "../../../../../Models/DatabaseModels/SecurityCaseTask";
import ProjectService from "../../../../../Server/Services/ProjectService";
import SecurityCaseFeedService from "../../../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService, {
  SECURITY_CASE_CONTAINED_BY_CHECKS_KEY,
} from "../../../../../Server/Services/SecurityCaseService";
import SecurityCaseStepCheckService from "../../../../../Server/Services/SecurityCaseStepCheckService";
import SecurityCaseTaskService from "../../../../../Server/Services/SecurityCaseTaskService";
import SecurityPlaybookRunService from "../../../../../Server/Services/SecurityPlaybookRunService";
import SecurityPlaybookService from "../../../../../Server/Services/SecurityPlaybookService";
import SecurityCaseMatches from "../../../../../Server/Utils/SecurityCase/Context/SecurityCaseMatches";
import SecurityCaseNotifications from "../../../../../Server/Utils/SecurityCase/SecurityCaseNotifications";
import { ContainmentStateReading } from "../../../../../Server/Utils/SecurityCase/StepChecks/Evidence/ContainmentState";
import SecurityCaseStepCheckRunner, {
  SECURITY_CASE_STEP_CHECK_IDLE_MINUTES,
  SECURITY_CASE_STEP_CHECK_LEASE_MINUTES,
  StepCheckRunOutcome,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/SecurityCaseStepCheckRunner";
import {
  StepCheck,
  StepCheckEvidence,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/StepCheck";
import { STEP_CHECKS } from "../../../../../Server/Utils/SecurityCase/StepChecks/StepCheckRegistry";
import {
  ProductContainment,
  ProductContainmentHow,
} from "../../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookContainment";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  SecurityCaseMatchBasis,
  SecurityCaseMatchedDetectionJson,
  SecurityCaseMatchesJson,
} from "../../../../../Types/SecurityCase/SecurityCaseMatches";
import SecurityCaseStage from "../../../../../Types/SecurityCase/SecurityCaseStage";
import { SecurityEntityType } from "../../../../../Types/SecurityCase/SecurityEntity";
import SecurityCaseStepCheckState from "../../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import SecurityEventRequestOutcome from "../../../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import { CHECK_COULD_NOT_CHECK } from "../../../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import {
  ADDRESS,
  AppRequest,
  CASE_ID,
  FakeEvidence,
  MINUTE,
  PROJECT_ID,
  at,
  fakeEvidence,
  requests,
} from "../../../../Helpers/SecurityCaseStepChecks";
import { testStatusId } from "../../../../Helpers/SecurityCaseValues";
import { stubSecurityCaseValues } from "../../../../Helpers/SecurityCaseValuesStub";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * One run of OneUptime's checks over a security case (#10340): the case is
 * claimed compare-and-set, so of two workers handed it one checks it; each
 * step's result is written compare-and-set too, so a step that stops
 * holding is told once, on the timeline and to the people on the case; a
 * case whose every containment step OneUptime verified moves to Contained,
 * when the project lets it; and the case is next read when its soonest step
 * is due.
 */

const RULE_ID: string = "44444444-4444-4444-8444-444444444444";
const USER: string = "alice@acme.com";
const BLOCK_KEY: string = `contain:block-ip:${ADDRESS}`;
const USER_KEY: string = `contain:user:${USER}`;

function detection(
  overrides: Partial<SecurityCaseMatchedDetectionJson> = {},
): SecurityCaseMatchedDetectionJson {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    source: "Detection Rule",
    title: `Path traversal attempts — ${ADDRESS}`,
    severity: "Medium",
    groupValue: ADDRESS,
    ruleName: "Path traversal attempts",
    eventCount: 12,
    fireCount: 1,
    firstSeenAt: at(0).toISOString(),
    lastSeenAt: at(5).toISOString(),
    sampleMessage: "",
    isOpening: true,
    rule: {
      id: RULE_ID,
      name: "Path traversal attempts",
      description: "",
      isEnabled: true,
      isRealTime: false,
      isCorrelation: false,
      threshold: 3,
      groupByField: "principalIp",
      distinctCountField: "",
      windowInMinutes: 5,
      sigmaRuleYaml: "",
      falsePositives: [],
      references: [],
      lookFor: [],
      responseSteps: [],
    },
    threatIntelFeedId: "",
    securityEventConnectionId: "",
    basis: SecurityCaseMatchBasis.RuleCondition,
    windowStart: at(0).toISOString(),
    windowEnd: at(5).toISOString(),
    events: [],
    isKept: false,
    keptPastRetentionCount: 0,
    hiddenEventCount: 0,
    matchedEventCount: 12,
    outcomes: { [SecurityEventRequestOutcome.Rejected]: 12 },
    ...overrides,
  };
}

// The account's detection: grouped on the user who signed in.
function accountDetection(): SecurityCaseMatchedDetectionJson {
  const opening: SecurityCaseMatchedDetectionJson = detection({
    groupValue: USER,
    title: `Impossible travel — ${USER}`,
    outcomes: {},
  });

  return {
    ...opening,
    rule: { ...opening.rule!, groupByField: "principalUser" },
  };
}

function matchesOf(
  opening: SecurityCaseMatchedDetectionJson,
): SecurityCaseMatchesJson {
  return {
    detections: [opening],
    detectionCount: 1,
    unreadableSources: [],
    failedSources: [],
  };
}

// CASE-52: a public scanner's path traversal, every request turned away.
function scannerCase(overrides: Partial<SecurityCase> = {}): SecurityCase {
  const securityCase: SecurityCase = new SecurityCase();
  securityCase.id = CASE_ID;
  securityCase.projectId = PROJECT_ID;
  securityCase.groupingKey = `rule:${ADDRESS}`;
  securityCase.securityCaseStatusId = testStatusId(SecurityCaseStage.New);
  securityCase.entities = [
    { type: SecurityEntityType.IpAddress, value: ADDRESS },
  ] as unknown as NonNullable<SecurityCase["entities"]>;
  securityCase.mitreTactics = ["TA0001"];
  securityCase.mitreTechniques = ["T1190"];
  securityCase.createdAt = at(2);
  securityCase.firstDetectedAt = at(0);
  securityCase.lastDetectedAt = at(5);
  securityCase.nextStepCheckAt = at(10);
  Object.assign(securityCase, overrides);
  return securityCase;
}

// A compromised account: grouped on the user, nothing about an address.
function accountCase(overrides: Partial<SecurityCase> = {}): SecurityCase {
  return scannerCase({
    groupingKey: `rule:${USER}`,
    entities: [
      { type: SecurityEntityType.User, value: USER },
    ] as unknown as NonNullable<SecurityCase["entities"]>,
    ...overrides,
  });
}

const OKTA_SUSPENDED: ContainmentStateReading = {
  answers: [
    {
      provider: "Okta",
      reading: {
        provider: "Okta",
        containment: ProductContainment.Contained,
        how: ProductContainmentHow.Suspended,
        since: at(8),
      },
    },
  ],
};

interface Recorded {
  claims: Array<JSONObject>;
  created: Array<SecurityCaseStepCheck>;
  rewritten: Array<JSONObject>;
  feed: Array<JSONObject>;
  regressions: Array<JSONObject>;
  updates: Array<JSONObject>;
}

let recorded: Recorded;
let rows: Array<SecurityCaseStepCheck>;
let tasks: Array<SecurityCaseTask>;
let matches: SecurityCaseMatchesJson | null;
let isClaimed: boolean;
let isRowWritten: boolean;
let markContained: boolean | undefined;

beforeEach(() => {
  recorded = {
    claims: [],
    created: [],
    rewritten: [],
    feed: [],
    regressions: [],
    updates: [],
  };
  rows = [];
  tasks = [];
  matches = matchesOf(detection());
  isClaimed = true;
  isRowWritten = true;
  markContained = undefined;

  stubSecurityCaseValues();

  jest
    .spyOn(SecurityCaseService, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation(async (data: unknown): Promise<boolean> => {
      recorded.claims.push(data as JSONObject);
      // The claim decides; the case's next moment, written last, always lands.
      return recorded.claims.length === 1 ? isClaimed : true;
    });
  jest
    .spyOn(SecurityCaseMatches, "build")
    .mockImplementation(async (): Promise<SecurityCaseMatchesJson> => {
      if (!matches) {
        throw new Error("the detections could not be read");
      }
      return matches;
    });
  jest.spyOn(SecurityPlaybookService, "findBy").mockResolvedValue([]);
  jest.spyOn(SecurityPlaybookRunService, "findBy").mockResolvedValue([]);
  jest
    .spyOn(SecurityCaseTaskService, "findBy")
    .mockImplementation(async (): Promise<Array<SecurityCaseTask>> => {
      return tasks;
    });
  jest
    .spyOn(SecurityCaseStepCheckService, "findBy")
    .mockImplementation(async (): Promise<Array<SecurityCaseStepCheck>> => {
      return rows;
    });
  jest
    .spyOn(SecurityCaseStepCheckService, "create")
    .mockImplementation(
      async (data: unknown): Promise<SecurityCaseStepCheck> => {
        const check: SecurityCaseStepCheck = (
          data as { data: SecurityCaseStepCheck }
        ).data;
        recorded.created.push(check);
        return check;
      },
    );
  jest
    .spyOn(SecurityCaseStepCheckService, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation(async (data: unknown): Promise<boolean> => {
      recorded.rewritten.push(data as JSONObject);
      return isRowWritten;
    });
  jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockImplementation(async (data: unknown): Promise<never> => {
      recorded.feed.push(data as JSONObject);
      return undefined as never;
    });
  jest
    .spyOn(SecurityCaseNotifications, "stepRegressed")
    .mockImplementation(async (data: unknown): Promise<void> => {
      recorded.regressions.push(data as JSONObject);
    });
  jest
    .spyOn(ProjectService, "findOneById")
    .mockImplementation(async (): Promise<Project> => {
      const project: Project = new Project();
      if (markContained !== undefined) {
        project.markSecurityCaseContainedWhenVerified = markContained;
      }
      return project;
    });
  jest
    .spyOn(SecurityCaseService, "updateOneById")
    .mockImplementation(async (data: unknown): Promise<number> => {
      recorded.updates.push(data as JSONObject);
      return 1;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function run(data: {
  securityCase?: SecurityCase;
  minute: number;
  evidence?: FakeEvidence;
  checks?: ReadonlyArray<StepCheck>;
  isEveryStepDue?: boolean;
}): Promise<StepCheckRunOutcome> {
  return await SecurityCaseStepCheckRunner.checkCase({
    securityCase: data.securityCase || scannerCase(),
    now: at(data.minute),
    isEveryStepDue: data.isEveryStepDue,
    evidence: (): StepCheckEvidence => {
      return fakeEvidence(data.evidence || {}).evidence;
    },
    checks: data.checks,
  });
}

// The rows the first run wrote, as the next run reads them back.
function keepWritten(): void {
  rows = recorded.created.map(
    (check: SecurityCaseStepCheck, index: number): SecurityCaseStepCheck => {
      check.id = new ObjectID(
        `dddddddd-dddd-4ddd-8ddd-${String(index).padStart(12, "0")}`,
      );
      return check;
    },
  );
  recorded.created = [];
}

const TURNED_AWAY: Array<AppRequest> = requests(21, { minute: 0, status: 404 });

describe("claiming a case", () => {
  test("claims it compare-and-set on its next moment, holding it for the lease", async () => {
    const outcome: StepCheckRunOutcome = await run({
      minute: 10,
      evidence: { appRequests: TURNED_AWAY },
    });

    expect(outcome.isClaimed).toBe(true);
    expect(recorded.claims[0]).toMatchObject({
      id: CASE_ID,
      data: {
        nextStepCheckAt: new Date(
          at(10).getTime() + SECURITY_CASE_STEP_CHECK_LEASE_MINUTES * MINUTE,
        ),
      },
      expectedData: { nextStepCheckAt: at(10) },
    });
  });

  test("a case another worker holds is left to it: nothing is read or written", async () => {
    isClaimed = false;

    const outcome: StepCheckRunOutcome = await run({ minute: 10 });

    expect(outcome.isClaimed).toBe(false);
    expect(SecurityCaseStepCheckService.findBy).not.toHaveBeenCalled();
    expect(recorded.created).toEqual([]);
    expect(recorded.claims).toHaveLength(1);
  });

  test("a closed case is checked no more: its next moment is cleared", async () => {
    const outcome: StepCheckRunOutcome = await run({
      securityCase: scannerCase({ closedAt: at(9) }),
      minute: 10,
    });

    expect(outcome.checkedStepKeys).toEqual([]);
    expect(recorded.claims[1]).toMatchObject({
      data: { nextStepCheckAt: null },
    });
  });
});

describe("checking the steps", () => {
  test("checks each step it has a check for, a row of its own each, and reads the case again at its soonest step", async () => {
    const outcome: StepCheckRunOutcome = await run({
      minute: 10,
      evidence: { appRequests: TURNED_AWAY },
    });

    expect(outcome.checkedStepKeys.sort()).toEqual(
      [
        "confirm:requests",
        `confirm:false-positive:${RULE_ID}`,
        BLOCK_KEY,
        "contain:incident",
      ].sort(),
    );
    expect(
      recorded.created.map((check: SecurityCaseStepCheck): string => {
        return `${check.stepKey} ${check.state}`;
      }),
    ).toEqual(
      expect.arrayContaining([
        `confirm:requests ${SecurityCaseStepCheckState.Verified}`,
        `${BLOCK_KEY} ${SecurityCaseStepCheckState.NotDone}`,
        `contain:incident ${SecurityCaseStepCheckState.NotNeeded}`,
        `confirm:false-positive:${RULE_ID} ${SecurityCaseStepCheckState.CannotTell}`,
      ]),
    );
    for (const check of recorded.created) {
      expect(check.projectId).toEqual(PROJECT_ID);
      expect(check.securityCaseId).toEqual(CASE_ID);
      expect(check.checkedAt).toEqual(at(10));
    }
    // The requests and the block are read every five minutes: the soonest.
    expect(recorded.claims[1]).toMatchObject({
      data: { nextStepCheckAt: at(15) },
      expectedData: {
        nextStepCheckAt: new Date(
          at(10).getTime() + SECURITY_CASE_STEP_CHECK_LEASE_MINUTES * MINUTE,
        ),
      },
    });
  });

  test("a step whose moment has not come is left alone, unless something on the case changed", async () => {
    await run({ minute: 10, evidence: { appRequests: TURNED_AWAY } });
    keepWritten();

    const early: StepCheckRunOutcome = await run({
      minute: 11,
      evidence: { appRequests: TURNED_AWAY },
    });

    expect(early.checkedStepKeys).toEqual([]);

    const changed: StepCheckRunOutcome = await run({
      minute: 11,
      evidence: { appRequests: TURNED_AWAY },
      isEveryStepDue: true,
    });

    expect(changed.checkedStepKeys).toHaveLength(4);
    // A row of its own already: written over, compare-and-set on when it was last checked.
    expect(recorded.rewritten[0]).toMatchObject({
      expectedData: { checkedAt: at(10) },
    });
  });

  test("a check that breaks says it could not check, and is read again in five minutes", async () => {
    const broken: StepCheck = {
      kind: "contain:block-ip",
      intervalInMinutes: 5,
      check: async (): Promise<never> => {
        throw new Error("boom");
      },
    };

    await run({
      minute: 10,
      evidence: { appRequests: TURNED_AWAY },
      checks: [broken],
    });

    expect(recorded.created).toHaveLength(1);
    expect(recorded.created[0]!.state).toBe(
      SecurityCaseStepCheckState.CannotTell,
    );
    expect(
      (recorded.created[0]!.evidence as JSONObject)["sentence"],
    ).toMatchObject({ template: CHECK_COULD_NOT_CHECK });
    expect(recorded.created[0]!.nextCheckAt).toEqual(at(15));
  });

  test("detections that cannot be read leave the incident step unknown, never not needed", async () => {
    matches = null;

    await run({ minute: 10, evidence: { appRequests: TURNED_AWAY } });

    const incident: SecurityCaseStepCheck | undefined = recorded.created.find(
      (check: SecurityCaseStepCheck): boolean => {
        return check.stepKey === "contain:incident";
      },
    );

    expect(incident?.state).not.toBe(SecurityCaseStepCheckState.NotNeeded);
  });
});

describe("a step that stops holding", () => {
  // The address went quiet at minute 20; at minute 70 it is back, and answered.
  const BACK: Array<AppRequest> = [
    ...TURNED_AWAY,
    ...requests(4, { minute: 70, status: 200, traceId: "trace" }),
  ];

  async function heldThenBack(): Promise<void> {
    await run({ minute: 60, evidence: { appRequests: TURNED_AWAY } });
    keepWritten();
  }

  test("is said on the case's timeline and to the people on it, once", async () => {
    await heldThenBack();

    const outcome: StepCheckRunOutcome = await run({
      minute: 75,
      evidence: { appRequests: BACK },
      isEveryStepDue: true,
    });

    expect(outcome.regressedStepKeys).toContain(BLOCK_KEY);
    expect(recorded.feed).toHaveLength(outcome.regressedStepKeys.length);
    const blockNotice: JSONObject | undefined = recorded.feed.find(
      (item: JSONObject): boolean => {
        return String(item["feedInfoInMarkdown"]).includes(
          `${ADDRESS} got through again`,
        );
      },
    );

    expect(blockNotice).toMatchObject({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      eventType: SecurityCaseFeedEventType.StepCheck,
      postedAt: at(75),
    });
    // The step it is about, in English, under the line.
    expect(String(blockNotice!["moreInformationInMarkdown"])).toContain(
      `Block ${ADDRESS} at your firewall, WAF or load balancer.`,
    );
    expect(
      recorded.regressions.map((notice: JSONObject): unknown => {
        return notice["stepKey"];
      }),
    ).toContain(BLOCK_KEY);

    // Read again while it keeps coming: the same regression, told no more.
    rows = rows.map((row: SecurityCaseStepCheck): SecurityCaseStepCheck => {
      const written: JSONObject | undefined = recorded.rewritten.find(
        (rewrite: JSONObject): boolean => {
          return (rewrite["id"] as ObjectID).toString() === row.id!.toString();
        },
      );
      return written ? Object.assign(row, written["data"] as JSONObject) : row;
    });
    recorded.feed = [];
    recorded.regressions = [];

    await run({
      minute: 80,
      evidence: { appRequests: BACK },
      isEveryStepDue: true,
    });

    expect(recorded.feed).toEqual([]);
    expect(recorded.regressions).toEqual([]);
  });

  test("written by another worker first, it is that worker's to tell", async () => {
    await heldThenBack();
    isRowWritten = false;

    const outcome: StepCheckRunOutcome = await run({
      minute: 75,
      evidence: { appRequests: BACK },
      isEveryStepDue: true,
    });

    expect(outcome.regressedStepKeys).toEqual([]);
    expect(recorded.feed).toEqual([]);
    expect(recorded.regressions).toEqual([]);
  });
});

describe("marking a case Contained", () => {
  test("moves a case whose every containment step OneUptime verified to Contained, saying why", async () => {
    matches = matchesOf(accountDetection());

    const outcome: StepCheckRunOutcome = await run({
      securityCase: accountCase(),
      minute: 10,
      evidence: { userState: OKTA_SUSPENDED },
    });

    expect(outcome.checkedStepKeys).toContain(USER_KEY);
    expect(outcome.isContained).toBe(true);
    expect(recorded.updates).toEqual([
      expect.objectContaining({
        id: CASE_ID,
        data: {
          securityCaseStatusId: testStatusId(SecurityCaseStage.Contained),
        },
        miscDataProps: { [SECURITY_CASE_CONTAINED_BY_CHECKS_KEY]: true },
      }),
    ]);
  });

  test("leaves it to a person when the project turned the setting off", async () => {
    matches = matchesOf(accountDetection());
    markContained = false;

    const outcome: StepCheckRunOutcome = await run({
      securityCase: accountCase(),
      minute: 10,
      evidence: { userState: OKTA_SUSPENDED },
    });

    expect(outcome.isContained).toBe(false);
    expect(recorded.updates).toEqual([]);
  });

  test("never on a step that only looks done: the scanner's address that went quiet waits for a person", async () => {
    const outcome: StepCheckRunOutcome = await run({
      minute: 60,
      evidence: { appRequests: TURNED_AWAY },
    });

    expect(
      recorded.created.find((check: SecurityCaseStepCheck): boolean => {
        return check.stepKey === BLOCK_KEY;
      })?.state,
    ).toBe(SecurityCaseStepCheckState.LooksDone);
    expect(outcome.isContained).toBe(false);
    expect(recorded.updates).toEqual([]);
  });

  test("never moves a case that is contained already", async () => {
    matches = matchesOf(accountDetection());

    await run({
      securityCase: accountCase({
        securityCaseStatusId: testStatusId(SecurityCaseStage.Contained),
      }),
      minute: 10,
      evidence: { userState: OKTA_SUSPENDED },
    });

    expect(recorded.updates).toEqual([]);
  });
});

describe("the every-minute run over the due cases", () => {
  test("reads the cases whose moment has come, the oldest first, each once a run", async () => {
    const first: SecurityCase = scannerCase();
    const findBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SecurityCaseService, "findBy")
      .mockImplementationOnce(async (): Promise<Array<SecurityCase>> => {
        return [first];
      })
      .mockImplementationOnce(async (): Promise<Array<SecurityCase>> => {
        // Held by another worker, it comes back: it is not looked at twice.
        return [first];
      });
    const checkCase: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SecurityCaseStepCheckRunner, "checkCase")
      .mockResolvedValue({
        isClaimed: true,
        checkedStepKeys: [],
        regressedStepKeys: [],
        isContained: false,
      });

    expect(await SecurityCaseStepCheckRunner.checkDueCases(at(10))).toBe(1);
    expect(checkCase).toHaveBeenCalledTimes(1);
    expect(findBy.mock.calls[0]![0]).toMatchObject({
      sort: { nextStepCheckAt: "ASC" },
      props: { isRoot: true },
    });
  });

  test("the idle moment of a case with nothing due is half an hour on (control)", () => {
    expect(SECURITY_CASE_STEP_CHECK_IDLE_MINUTES).toBe(30);
    expect(STEP_CHECKS.length).toBe(6);
  });
});
