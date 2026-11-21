import Project from "../../../../../Models/DatabaseModels/Project";
import SecurityCase from "../../../../../Models/DatabaseModels/SecurityCase";
import { SecurityCaseFeedEventType } from "../../../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityCaseStepCheck from "../../../../../Models/DatabaseModels/SecurityCaseStepCheck";
import ProjectService from "../../../../../Server/Services/ProjectService";
import SecurityCaseFeedService from "../../../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../../../Server/Services/SecurityCaseService";
import SecurityCaseStepCheckService from "../../../../../Server/Services/SecurityCaseStepCheckService";
import SecurityCaseTaskService from "../../../../../Server/Services/SecurityCaseTaskService";
import SecurityPlaybookRunService from "../../../../../Server/Services/SecurityPlaybookRunService";
import SecurityPlaybookService from "../../../../../Server/Services/SecurityPlaybookService";
import SecurityCaseMatches from "../../../../../Server/Utils/SecurityCase/Context/SecurityCaseMatches";
import SecurityCaseNotifications from "../../../../../Server/Utils/SecurityCase/SecurityCaseNotifications";
import { ServiceDeploy } from "../../../../../Server/Utils/SecurityCase/StepChecks/Evidence/FixChanges";
import FixStepState, {
  ROUTE_FIX_STEP_KEY,
  RouteFixState,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/FixStepState";
import SecurityCaseStepCheckRunner, {
  StepCheckRunOutcome,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/SecurityCaseStepCheckRunner";
import { StepCheckEvidence } from "../../../../../Server/Utils/SecurityCase/StepChecks/StepCheck";
import { getStepCheck } from "../../../../../Server/Utils/SecurityCase/StepChecks/StepCheckRegistry";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  SecurityCaseMatchBasis,
  SecurityCaseMatchedEventJson,
  SecurityCaseMatchesJson,
} from "../../../../../Types/SecurityCase/SecurityCaseMatches";
import { SECURITY_LOG_RESOURCE_ID_ATTRIBUTE } from "../../../../../Types/SecurityCase/SecurityConnection";
import SecurityCaseStage from "../../../../../Types/SecurityCase/SecurityCaseStage";
import { SecurityEntityType } from "../../../../../Types/SecurityCase/SecurityEntity";
import SecurityCaseStepCheckState from "../../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import SecurityEventRequestOutcome, {
  SECURITY_REQUEST_ATTRIBUTES,
} from "../../../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import ServiceType from "../../../../../Types/Telemetry/ServiceType";
import {
  CHECK_FIX_CANNOT_NO_DEPLOYS,
  CHECK_FIX_ROUTE_NO_ATTEMPTS,
  CHECK_FIX_ROUTE_STILL_DATABASE,
  CHECK_FIX_ROUTE_STILL_THROUGH,
  CHECK_FIX_ROUTE_TURNED_AWAY,
} from "../../../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import { WEB_ATTACK_KIND_ATTRIBUTE } from "../../../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import {
  ADDRESS,
  AttackRequest,
  CASE_ID,
  FakeEvidence,
  PROJECT_ID,
  at,
  attacks,
  fakeEvidence,
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
 * The Fix step's check through the real pipeline (#10347): the worker
 * claims a case about a SQL injection on /api/search, builds its Response
 * Plan with the builder the card draws it with - the plan's Fix step names
 * the route its requests went to - and the registry hands that step to the
 * route's check, which reads the attack requests before and after the
 * deploy that shipped the fix. What it found is written as the step's row,
 * and a fix that stops holding is said on the case's timeline and to its
 * people, once. What acts on the fix (a virtual patch, #10351; OneUptime AI,
 * #10352) reads that row back.
 */

const ROUTE: string = "/api/search";
const SERVICE_ID: string = "55555555-5555-4555-8555-555555555555";
const KEY: string = "fix:public-app";

function attackEvent(index: number): SecurityCaseMatchedEventJson {
  return {
    time: at(index).toISOString(),
    eventUid: `event-${index}`,
    sourceId: SERVICE_ID,
    severityName: "High",
    className: "HTTP Activity",
    categoryName: "Network Activity",
    activityName: "GET",
    statusName: "Success",
    message: "SQL injection attempt",
    vendorName: "",
    productName: "",
    ruleName: "",
    principalUser: "",
    principalHost: "",
    principalIp: ADDRESS,
    targetUser: "",
    targetHost: "",
    targetIp: "",
    targetPort: null,
    processName: "",
    processCommandLine: "",
    observables: [ADDRESS],
    mitreTactics: ["TA0001"],
    mitreTechniques: ["T1190"],
    attributes: {
      [SECURITY_REQUEST_ATTRIBUTES.url]: `/api/search?q=${index}%27%20OR%201%3D1`,
      [WEB_ATTACK_KIND_ATTRIBUTE]: "sql-injection",
      [SECURITY_LOG_RESOURCE_ID_ATTRIBUTE]: SERVICE_ID,
      "oneuptime.log.resource.type": ServiceType.OpenTelemetry,
    },
    traceId: `trace-${index}`,
    spanId: "",
    sessionId: "",
    requestOutcome: SecurityEventRequestOutcome.ReachedDatabase,
    hunt: null,
  };
}

const MATCHES: SecurityCaseMatchesJson = {
  detections: [
    {
      id: "66666666-6666-4666-8666-666666666666",
      source: "Detection Rule",
      title: `SQL injection attempts — ${ADDRESS}`,
      severity: "High",
      groupValue: ADDRESS,
      ruleName: "SQL injection attempts",
      eventCount: 3,
      fireCount: 1,
      firstSeenAt: at(0).toISOString(),
      lastSeenAt: at(20).toISOString(),
      sampleMessage: "",
      isOpening: true,
      rule: null,
      threatIntelFeedId: "",
      securityEventConnectionId: "",
      basis: SecurityCaseMatchBasis.RuleCondition,
      windowStart: at(0).toISOString(),
      windowEnd: at(20).toISOString(),
      events: [attackEvent(0), attackEvent(1), attackEvent(2)],
      isKept: true,
      keptPastRetentionCount: 0,
      hiddenEventCount: 0,
      matchedEventCount: 3,
      outcomes: { [SecurityEventRequestOutcome.ReachedDatabase]: 3 },
    },
  ],
  detectionCount: 1,
  unreadableSources: [],
  failedSources: [],
};

function exploitCase(): SecurityCase {
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
  securityCase.lastDetectedAt = at(20);
  securityCase.nextStepCheckAt = at(10);
  return securityCase;
}

const BEFORE: Array<AttackRequest> = [
  ...attacks(18, { minute: 0, outcome: SecurityEventRequestOutcome.Rejected }),
  ...attacks(6, {
    minute: 18,
    outcome: SecurityEventRequestOutcome.ReachedDatabase,
  }),
];

const DEPLOY: ServiceDeploy = {
  id: "deploy-60",
  time: at(60),
  serviceId: SERVICE_ID,
  label: "v2.4.1",
};

interface Recorded {
  created: Array<SecurityCaseStepCheck>;
  rewritten: Array<JSONObject>;
  feed: Array<JSONObject>;
  regressions: Array<JSONObject>;
  updates: Array<JSONObject>;
}

let recorded: Recorded;
let rows: Array<SecurityCaseStepCheck>;

beforeEach(() => {
  recorded = {
    created: [],
    rewritten: [],
    feed: [],
    regressions: [],
    updates: [],
  };
  rows = [];

  stubSecurityCaseValues();

  jest
    .spyOn(SecurityCaseService, "compareAndSetColumnsByIdWithoutHooks")
    .mockResolvedValue(true);
  jest.spyOn(SecurityCaseMatches, "build").mockResolvedValue(MATCHES);
  jest.spyOn(SecurityPlaybookService, "findBy").mockResolvedValue([]);
  jest.spyOn(SecurityPlaybookRunService, "findBy").mockResolvedValue([]);
  jest.spyOn(SecurityCaseTaskService, "findBy").mockResolvedValue([]);
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
      return true;
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
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue(new Project());
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
  minute: number;
  evidence: FakeEvidence;
}): Promise<StepCheckRunOutcome> {
  return await SecurityCaseStepCheckRunner.checkCase({
    securityCase: exploitCase(),
    now: at(data.minute),
    isEveryStepDue: true,
    evidence: (): StepCheckEvidence => {
      return fakeEvidence({
        ...data.evidence,
        fixChanges: {
          serviceNames: { [SERVICE_ID]: "search-api" },
          ...data.evidence.fixChanges,
        },
      }).evidence;
    },
  });
}

function fixRow(): SecurityCaseStepCheck | undefined {
  return recorded.created.find((check: SecurityCaseStepCheck): boolean => {
    return check.stepKey === KEY;
  });
}

function sentenceOf(check: SecurityCaseStepCheck | undefined): JSONObject {
  return (check?.evidence as JSONObject)["sentence"] as JSONObject;
}

// The rows the run wrote, as the next run reads them back.
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

describe("the plan's Fix step goes to the route's check", () => {
  test("the registry hands fix:public-app to it, and the plan names the route its requests went to", () => {
    expect(getStepCheck(KEY)?.kind).toBe("fix:public-app");
    expect(getStepCheck("fix:credentials")?.kind).toBe("fix:credentials");
    expect(getStepCheck("fix:brute-force")?.kind).toBe("fix:brute-force");
    // A Fix step OneUptime cannot read back stays a person's.
    expect(getStepCheck("fix:account-changes")).toBeNull();
    expect(getStepCheck("fix:persistence")).toBeNull();
    expect(ROUTE_FIX_STEP_KEY).toBe(KEY);
  });
});

describe("attack requests before and after a deploy, through the real pipeline", () => {
  test("rejected after: verified, and written as the step's row", async () => {
    const outcome: StepCheckRunOutcome = await run({
      minute: 300,
      evidence: {
        attacks: [
          ...BEFORE,
          ...attacks(18, {
            minute: 120,
            outcome: SecurityEventRequestOutcome.Rejected,
          }),
        ],
        fixChanges: { deploys: [DEPLOY] },
      },
    });

    expect(outcome.checkedStepKeys).toContain(KEY);
    expect(fixRow()?.state).toBe(SecurityCaseStepCheckState.Verified);
    expect(sentenceOf(fixRow())).toEqual({
      template: CHECK_FIX_ROUTE_TURNED_AWAY,
      values: { route: ROUTE, change: "v2.4.1" },
      times: { time: at(60).toISOString() },
      count: 18,
    });
    expect(fixRow()?.projectId).toEqual(PROJECT_ID);
    expect(fixRow()?.securityCaseId).toEqual(CASE_ID);
    // A Fix step never moves a case to Contained: only the steps that contain it do.
    expect(recorded.updates).toEqual([]);
  });

  test("still reaching the database after it: not fixed, and says so", async () => {
    await run({
      minute: 300,
      evidence: {
        attacks: [
          ...BEFORE,
          ...attacks(3, {
            minute: 130,
            outcome: SecurityEventRequestOutcome.ReachedDatabase,
          }),
        ],
        fixChanges: { deploys: [DEPLOY] },
      },
    });

    expect(fixRow()?.state).toBe(SecurityCaseStepCheckState.NotDone);
    expect(sentenceOf(fixRow())).toMatchObject({
      template: CHECK_FIX_ROUTE_STILL_DATABASE,
      numbers: { through: 3 },
      count: 3,
    });
  });

  test("still reaching the app after it, where before it got no further: not fixed, and says so", async () => {
    await run({
      minute: 300,
      evidence: {
        attacks: [
          ...attacks(18, {
            minute: 0,
            outcome: SecurityEventRequestOutcome.Rejected,
          }),
          ...attacks(6, {
            minute: 18,
            outcome: SecurityEventRequestOutcome.ReachedApp,
          }),
          ...attacks(4, {
            minute: 130,
            outcome: SecurityEventRequestOutcome.Rejected,
          }),
          ...attacks(2, {
            minute: 140,
            outcome: SecurityEventRequestOutcome.ReachedApp,
          }),
        ],
        fixChanges: { deploys: [DEPLOY] },
      },
    });

    expect(fixRow()?.state).toBe(SecurityCaseStepCheckState.NotDone);
    expect(sentenceOf(fixRow())).toEqual({
      template: CHECK_FIX_ROUTE_STILL_THROUGH,
      values: { route: ROUTE, change: "v2.4.1" },
      numbers: { through: 2 },
      times: { time: at(60).toISOString() },
      count: 6,
    });
  });

  test("no attempts since: says exactly that, and is read again while it is watched", async () => {
    await run({
      minute: 300,
      evidence: { attacks: BEFORE, fixChanges: { deploys: [DEPLOY] } },
    });

    expect(fixRow()?.state).toBe(SecurityCaseStepCheckState.LooksDone);
    expect(sentenceOf(fixRow())).toEqual({
      template: CHECK_FIX_ROUTE_NO_ATTEMPTS,
      values: { route: ROUTE, change: "v2.4.1" },
      times: { time: at(60).toISOString() },
    });
    expect(fixRow()?.nextCheckAt).toEqual(at(315));
  });

  test("no deploy data: OneUptime cannot tell, never done", async () => {
    await run({
      minute: 300,
      evidence: {
        attacks: BEFORE,
        fixChanges: { deploys: [], hasDeployData: false },
      },
    });

    expect(fixRow()?.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(sentenceOf(fixRow())).toEqual({
      template: CHECK_FIX_CANNOT_NO_DEPLOYS,
      values: { service: "search-api" },
    });
  });

  test("a fix that stops holding is said on the timeline and to the people on the case, once", async () => {
    await run({
      minute: 100,
      evidence: { attacks: BEFORE, fixChanges: { deploys: [DEPLOY] } },
    });
    keepWritten();

    const back: Array<AttackRequest> = [
      ...BEFORE,
      ...attacks(1, {
        minute: 200,
        outcome: SecurityEventRequestOutcome.ReachedDatabase,
      }),
    ];
    const outcome: StepCheckRunOutcome = await run({
      minute: 210,
      evidence: { attacks: back, fixChanges: { deploys: [DEPLOY] } },
    });

    expect(outcome.regressedStepKeys).toContain(KEY);

    const notice: JSONObject | undefined = recorded.feed.find(
      (item: JSONObject): boolean => {
        return String(item["feedInfoInMarkdown"]).includes(
          "the fix is not holding",
        );
      },
    );

    expect(notice).toMatchObject({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      eventType: SecurityCaseFeedEventType.StepCheck,
    });
    expect(String(notice!["feedInfoInMarkdown"])).toContain(
      `An attack request to ${ROUTE} reached the database`,
    );
    // The step it is about, in English, under the line.
    expect(String(notice!["moreInformationInMarkdown"])).toContain(
      `Fix how ${ROUTE} handles what it is sent`,
    );
    expect(
      recorded.regressions.map((regression: JSONObject): unknown => {
        return regression["stepKey"];
      }),
    ).toContain(KEY);
  });
});

describe("what acts on the fix reads it back", () => {
  test("a verified fix, as the row the card shows: what a virtual patch's lift and OneUptime AI read", async () => {
    await run({
      minute: 300,
      evidence: {
        attacks: [
          ...BEFORE,
          ...attacks(18, {
            minute: 120,
            outcome: SecurityEventRequestOutcome.Rejected,
          }),
        ],
        fixChanges: { deploys: [DEPLOY] },
      },
    });

    const row: SecurityCaseStepCheck = fixRow()!;
    const findOneBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SecurityCaseStepCheckService, "findOneBy")
      .mockResolvedValue(row);
    const state: RouteFixState = await FixStepState.readRouteFix({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
    });

    expect(state).toMatchObject({
      state: SecurityCaseStepCheckState.Verified,
      isVerified: true,
      route: ROUTE,
      change: "v2.4.1",
      shippedAt: at(60),
      checkedAt: at(300),
    });
    expect(findOneBy.mock.calls[0]![0]).toMatchObject({
      query: {
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        stepKey: KEY,
      },
      props: { isRoot: true },
    });
  });

  test("a fix never checked, or that only looks done, is not verified", async () => {
    jest
      .spyOn(SecurityCaseStepCheckService, "findOneBy")
      .mockResolvedValue(null);

    expect(
      await FixStepState.readRouteFix({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
      }),
    ).toMatchObject({ state: null, isVerified: false });

    await run({
      minute: 300,
      evidence: { attacks: BEFORE, fixChanges: { deploys: [DEPLOY] } },
    });
    jest
      .spyOn(SecurityCaseStepCheckService, "findOneBy")
      .mockResolvedValue(fixRow()!);

    expect(
      await FixStepState.readRouteFix({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
      }),
    ).toMatchObject({
      state: SecurityCaseStepCheckState.LooksDone,
      isVerified: false,
    });
  });
});
