import {
  FixPullRequest,
  ServiceDeploy,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/Evidence/FixChanges";
import FixRouteStepCheck, {
  FIX_ROUTE_MAX_PROOF,
  FIX_ROUTE_MIN_PROOF,
  FIX_ROUTE_ROLLOUT_GRACE_MINUTES,
  FIX_ROUTE_WATCH_DAYS,
  FixRouteCriterion,
  ShippedChange,
  getFixRouteWindow,
  getNeededProof,
  getShippedChanges,
  pickFixingChange,
} from "../../../../../Server/Utils/SecurityCase/StepChecks/FixRouteStepCheck";
import { settleStepCheck } from "../../../../../Server/Utils/SecurityCase/StepChecks/SecurityCaseStepCheckRunner";
import { StepCheckResult } from "../../../../../Server/Utils/SecurityCase/StepChecks/StepCheck";
import PullRequestState from "../../../../../Types/CodeRepository/PullRequestState";
import { ResponseLinkKind } from "../../../../../Types/SecurityCase/SecurityCaseResponseLink";
import {
  SecurityCaseMatchBasis,
  SecurityCaseMatchedEventJson,
  SecurityCaseMatchesJson,
} from "../../../../../Types/SecurityCase/SecurityCaseMatches";
import { SECURITY_LOG_RESOURCE_ID_ATTRIBUTE } from "../../../../../Types/SecurityCase/SecurityConnection";
import SecurityCaseStepCheckState from "../../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import SecurityEventRequestOutcome, {
  SECURITY_REQUEST_ATTRIBUTES,
} from "../../../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import ServiceType from "../../../../../Types/Telemetry/ServiceType";
import {
  CHECK_CANNOT_READ_FAILED,
  CHECK_FIX_CANNOT_NOT_FOLLOWED,
  CHECK_FIX_CANNOT_NO_DEPLOYS,
  CHECK_FIX_CANNOT_NO_SERVICE,
  CHECK_FIX_FACT_BEFORE_DATABASE,
  CHECK_FIX_FACT_BEFORE_THROUGH,
  CHECK_FIX_FACT_EDGE_STOPPED,
  CHECK_FIX_FACT_NONE_BEFORE,
  CHECK_FIX_FACT_TOO_FEW_BEFORE,
  CHECK_FIX_FACT_UNFOLLOWED,
  CHECK_FIX_FACT_WATCHING,
  CHECK_FIX_FACT_WATCHING_DATABASE,
  CHECK_FIX_FACT_WATCH_ENDED,
  CHECK_FIX_NOTHING_SHIPPED,
  CHECK_FIX_PULL_REQUEST_NOT_SHIPPED,
  CHECK_FIX_PULL_REQUEST_OPEN,
  CHECK_FIX_ROUTE_KEPT_OUT,
  CHECK_FIX_ROUTE_NO_ATTEMPTS,
  CHECK_FIX_ROUTE_REGRESSED,
  CHECK_FIX_ROUTE_REGRESSED_DATABASE,
  CHECK_FIX_ROUTE_STILL_DATABASE,
  CHECK_FIX_ROUTE_STILL_THROUGH,
  CHECK_FIX_ROUTE_TURNED_AWAY,
} from "../../../../../Utils/SecurityCase/ResponsePlan/StepCheckWords";
import {
  RouteMatchKind,
  getRouteAttackScope,
  getRouteMatch,
  isPathOnRoute,
} from "../../../../../Utils/SecurityCase/RouteAttackScope";
import { WEB_ATTACK_KIND_ATTRIBUTE } from "../../../../../Utils/SecurityEvent/LogParsers/WebAttackLogParser";
import {
  AttackRequest,
  DETECTED_AT,
  FakeEvidence,
  MINUTE,
  RecordingEvidence,
  at,
  attacks,
  context,
  fakeEvidence,
  planStep,
  previousCheck,
  stepTarget,
  tick,
} from "../../../../Helpers/SecurityCaseStepChecks";
import { describe, expect, test } from "@jest/globals";

/*
 * "Fix how /api/search handles what it is sent" (#10347): whether the fix
 * worked, from the attack itself. A change ships to the service behind the
 * route - Fix With AI's pull request, or any deploy of the service - and
 * the same kind of attack on the same route, which used to reach the
 * database, is turned away since.
 *
 * Each case below runs the check as the worker does, with the case's
 * attack requests counted the way RouteAttacks' statement counts them in
 * ClickHouse (readAttacks): before the change, after its rollout grace,
 * the edge's apart.
 */

const KEY: string = "fix:public-app";
const ROUTE: string = "/api/search";
const SERVICE_ID: string = "55555555-5555-4555-8555-555555555555";
const DAY: number = 24 * 60 * MINUTE;

// One of the requests the opening detection matched: a SQL injection on the route.
function attackEvent(
  overrides: Partial<SecurityCaseMatchedEventJson> = {},
): SecurityCaseMatchedEventJson {
  return {
    time: at(0).toISOString(),
    eventUid: "event-1",
    sourceId: SERVICE_ID,
    severityName: "High",
    className: "HTTP Activity",
    categoryName: "Network Activity",
    activityName: "GET",
    statusName: "Success",
    message: "SQL injection attempt: GET /api/search?q=1' OR 1=1",
    vendorName: "",
    productName: "",
    ruleName: "",
    principalUser: "",
    principalHost: "",
    principalIp: "35.196.249.14",
    targetUser: "",
    targetHost: "",
    targetIp: "",
    targetPort: null,
    processName: "",
    processCommandLine: "",
    observables: [],
    mitreTactics: ["TA0001"],
    mitreTechniques: ["T1190"],
    attributes: {
      [SECURITY_REQUEST_ATTRIBUTES.url]: "/api/search?q=1%27%20OR%201%3D1",
      [WEB_ATTACK_KIND_ATTRIBUTE]: "sql-injection",
      [SECURITY_LOG_RESOURCE_ID_ATTRIBUTE]: SERVICE_ID,
      "oneuptime.log.resource.type": ServiceType.OpenTelemetry,
    },
    traceId: "trace-1",
    spanId: "",
    sessionId: "",
    requestOutcome: SecurityEventRequestOutcome.ReachedDatabase,
    hunt: null,
    ...overrides,
  };
}

function matchesOf(
  events: Array<SecurityCaseMatchedEventJson> = [attackEvent()],
): SecurityCaseMatchesJson {
  return {
    detections: [
      {
        id: "66666666-6666-4666-8666-666666666666",
        source: "Detection Rule",
        title: "SQL injection attempts",
        severity: "High",
        groupValue: "35.196.249.14",
        ruleName: "SQL injection attempts",
        eventCount: events.length,
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
        events,
        isKept: true,
        keptPastRetentionCount: 0,
        hiddenEventCount: 0,
        matchedEventCount: events.length,
        outcomes: {},
      },
    ],
    detectionCount: 1,
    unreadableSources: [],
    failedSources: [],
  };
}

// The attack before anything shipped: 18 turned away, 6 into the database.
const BEFORE: Array<AttackRequest> = [
  ...attacks(18, {
    minute: 0,
    outcome: SecurityEventRequestOutcome.Rejected,
  }),
  ...attacks(6, {
    minute: 18,
    outcome: SecurityEventRequestOutcome.ReachedDatabase,
    traceId: "before",
  }),
];

// v2.4.1 of the service behind the route, an hour after the case opened.
function deploy(minute: number, label: string = "v2.4.1"): ServiceDeploy {
  return {
    id: `deploy-${minute}`,
    time: at(minute),
    serviceId: SERVICE_ID,
    label,
  };
}

function pullRequest(overrides: Partial<FixPullRequest> = {}): FixPullRequest {
  return {
    id: "77777777-7777-4777-8777-777777777777",
    number: 123,
    url: "https://github.com/acme/search/pull/123",
    host: "GitHub",
    state: PullRequestState.Open,
    mergedAt: null,
    deployedAt: null,
    deployedVersion: "",
    deployedCommitSha: "",
    ...overrides,
  };
}

const NAMES: Record<string, string> = { [SERVICE_ID]: "search-api" };

async function check(data: {
  minute: number;
  evidence: FakeEvidence;
  previous?: ReturnType<typeof previousCheck> | null;
  task?: ReturnType<typeof tick> | null;
  matches?: SecurityCaseMatchesJson | null;
  route?: string;
}): Promise<{ result: StepCheckResult | null; recorded: RecordingEvidence }> {
  const recorded: RecordingEvidence = fakeEvidence({
    ...data.evidence,
    fixChanges: { serviceNames: NAMES, ...data.evidence.fixChanges },
  });
  const result: StepCheckResult | null = await FixRouteStepCheck.check(
    context({
      target: stepTarget({
        step: planStep(KEY, "", { route: data.route ?? ROUTE }),
        previous: data.previous || null,
        task: data.task || null,
      }),
      evidence: recorded.evidence,
      minute: data.minute,
      securityCase: {
        matches: data.matches === undefined ? matchesOf() : data.matches,
      },
    }),
  );

  return { result, recorded };
}

async function checked(
  data: Parameters<typeof check>[0],
): Promise<StepCheckResult> {
  const { result } = await check(data);

  expect(result).not.toBeNull();

  return result!;
}

describe("the attack is turned away after the fix shipped", () => {
  test("rejected after the deploy, where before it reached the database: verified, in the issue's words", async () => {
    const result: StepCheckResult = await checked({
      minute: 300,
      evidence: {
        attacks: [
          ...BEFORE,
          ...attacks(18, {
            minute: 120,
            outcome: SecurityEventRequestOutcome.Rejected,
          }),
        ],
        fixChanges: { deploys: [deploy(60)] },
      },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.Verified);
    // "Since v2.4.1 shipped at 14:10, all 18 attack requests to /api/search were turned away."
    expect(result.evidence.sentence).toEqual({
      template: CHECK_FIX_ROUTE_TURNED_AWAY,
      values: { route: ROUTE, change: "v2.4.1" },
      times: { time: at(60).toISOString() },
      count: 18,
    });
    // "Before it, 6 reached the database."
    expect(result.evidence.facts).toContainEqual({
      template: CHECK_FIX_FACT_BEFORE_DATABASE,
      values: {},
      numbers: { through: 6 },
      count: 24,
    });
    expect(result.evidence.data).toMatchObject({
      route: ROUTE,
      change: "v2.4.1",
      shippedAt: at(60).toISOString(),
      criterion: FixRouteCriterion.KeptOutOfDatabase,
      needed: 11,
      doneSince: at(60 + FIX_ROUTE_ROLLOUT_GRACE_MINUTES).toISOString(),
    });
  });

  test("answered now, but kept out of the database: the SQL no longer runs what it is sent, and that is the fix", async () => {
    const result: StepCheckResult = await checked({
      minute: 300,
      evidence: {
        attacks: [
          ...BEFORE,
          ...attacks(12, {
            minute: 120,
            outcome: SecurityEventRequestOutcome.ReachedApp,
          }),
        ],
        fixChanges: { deploys: [deploy(60)] },
      },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.Verified);
    expect(result.evidence.sentence).toMatchObject({
      template: CHECK_FIX_ROUTE_KEPT_OUT,
      count: 12,
    });
  });

  test("a route that only ever reached the app must turn the attack away: answering it is not fixed", async () => {
    const result: StepCheckResult = await checked({
      minute: 300,
      evidence: {
        attacks: [
          ...attacks(4, {
            minute: 0,
            outcome: SecurityEventRequestOutcome.ReachedApp,
            traceId: "before",
          }),
          ...attacks(5, {
            minute: 120,
            outcome: SecurityEventRequestOutcome.ReachedApp,
            traceId: "after",
          }),
        ],
        fixChanges: { deploys: [deploy(60)] },
      },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.NotDone);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_FIX_ROUTE_STILL_THROUGH,
      values: { route: ROUTE, change: "v2.4.1" },
      numbers: { through: 5 },
      times: { time: at(60).toISOString() },
      count: 5,
    });
    expect(result.evidence.facts).toContainEqual({
      template: CHECK_FIX_FACT_BEFORE_THROUGH,
      values: {},
      numbers: { through: 4 },
      count: 4,
    });
    // The requests that got through since, to open.
    expect(result.evidence.links[0]).toMatchObject({
      kind: ResponseLinkKind.OpenTraces,
      traceIds: ["after-0", "after-1", "after-2", "after-3", "after-4"],
    });
  });
});

describe("the attack still gets through: not fixed, and says so", () => {
  test("still reaching the database after the deploy", async () => {
    const result: StepCheckResult = await checked({
      minute: 300,
      evidence: {
        attacks: [
          ...BEFORE,
          ...attacks(2, {
            minute: 120,
            outcome: SecurityEventRequestOutcome.Rejected,
          }),
          ...attacks(3, {
            minute: 130,
            outcome: SecurityEventRequestOutcome.ReachedDatabase,
            traceId: "still",
          }),
        ],
        fixChanges: { deploys: [deploy(60)] },
      },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.NotDone);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_FIX_ROUTE_STILL_DATABASE,
      values: { route: ROUTE, change: "v2.4.1" },
      numbers: { through: 3 },
      times: { time: at(60).toISOString() },
      count: 5,
    });
  });

  test("old instances still serving the old code in the rollout grace are no failure of the fix", async () => {
    const result: StepCheckResult = await checked({
      minute: 300,
      evidence: {
        attacks: [
          ...BEFORE,
          // Right after the deploy, before the rollout is over.
          ...attacks(2, {
            minute: 62,
            outcome: SecurityEventRequestOutcome.ReachedDatabase,
          }),
          ...attacks(18, {
            minute: 120,
            outcome: SecurityEventRequestOutcome.Rejected,
          }),
        ],
        fixChanges: { deploys: [deploy(60)] },
      },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.Verified);
    expect(result.evidence.sentence).toMatchObject({ count: 18 });
  });

  test("an attack that gets through after the fix looked done stops it holding, and is said once", async () => {
    const held: StepCheckResult = await checked({
      minute: 100,
      evidence: {
        attacks: BEFORE,
        fixChanges: { deploys: [deploy(60)] },
      },
    });

    expect(held.state).toBe(SecurityCaseStepCheckState.LooksDone);

    const previous: ReturnType<typeof previousCheck> = previousCheck({
      stepKey: KEY,
      state: held.state,
      evidence: held.evidence,
      stateSince: at(100),
    });
    const back: Array<AttackRequest> = [
      ...BEFORE,
      ...attacks(1, {
        minute: 200,
        outcome: SecurityEventRequestOutcome.ReachedDatabase,
        traceId: "back",
      }),
    ];
    const regressed: StepCheckResult = await checked({
      minute: 210,
      previous,
      evidence: { attacks: back, fixChanges: { deploys: [deploy(60)] } },
    });

    expect(regressed.state).toBe(SecurityCaseStepCheckState.Regressed);
    expect(regressed.evidence.sentence).toEqual({
      template: CHECK_FIX_ROUTE_REGRESSED_DATABASE,
      values: { route: ROUTE, change: "v2.4.1" },
      times: { time: at(200).toISOString() },
    });

    const settled: ReturnType<typeof settleStepCheck> = settleStepCheck({
      previous,
      result: regressed,
      now: at(210),
      intervalInMinutes: FixRouteStepCheck.intervalInMinutes,
    });

    expect(settled.isNewRegression).toBe(true);

    // Read again while it keeps getting through: the same regression, told no more.
    const again: StepCheckResult = await checked({
      minute: 230,
      previous: previousCheck({
        stepKey: KEY,
        state: regressed.state,
        evidence: regressed.evidence,
        stateSince: at(210),
      }),
      evidence: {
        attacks: [
          ...back,
          ...attacks(1, {
            minute: 220,
            outcome: SecurityEventRequestOutcome.ReachedDatabase,
          }),
        ],
        fixChanges: { deploys: [deploy(60)] },
      },
    });

    expect(again.state).toBe(SecurityCaseStepCheckState.Regressed);
    expect(again.evidence.data["regressedAt"]).toBe(at(200).toISOString());
  });

  test("a person's tick, then the attack getting through, stops it holding too", async () => {
    const result: StepCheckResult = await checked({
      minute: 300,
      task: tick(KEY, 90),
      evidence: {
        attacks: [
          ...BEFORE,
          ...attacks(1, {
            minute: 150,
            outcome: SecurityEventRequestOutcome.ReachedApp,
          }),
        ],
        // The first deploy did not keep it out of the database either.
        fixChanges: { deploys: [deploy(60)] },
      },
    });

    // Kept out of the database is what counts here: an answer is no failure.
    expect(result.state).toBe(SecurityCaseStepCheckState.LooksDone);

    const through: StepCheckResult = await checked({
      minute: 300,
      task: tick(KEY, 90),
      evidence: {
        attacks: [
          ...attacks(4, {
            minute: 0,
            outcome: SecurityEventRequestOutcome.ReachedApp,
          }),
          ...attacks(1, {
            minute: 150,
            outcome: SecurityEventRequestOutcome.ReachedApp,
          }),
        ],
        fixChanges: { deploys: [deploy(60)] },
      },
    });

    expect(through.state).toBe(SecurityCaseStepCheckState.Regressed);
    expect(through.evidence.sentence).toMatchObject({
      template: CHECK_FIX_ROUTE_REGRESSED,
      times: { time: at(150).toISOString() },
    });
  });
});

describe("which change fixed it", () => {
  test("a later deploy that changed nothing never resets the proof: the fix is the earliest after the last attack that got through", async () => {
    const result: StepCheckResult = await checked({
      minute: 400,
      evidence: {
        attacks: [
          ...BEFORE,
          ...attacks(18, {
            minute: 100,
            outcome: SecurityEventRequestOutcome.Rejected,
            everyMinutes: 10,
          }),
        ],
        fixChanges: { deploys: [deploy(60), deploy(200, "v2.4.2")] },
      },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.Verified);
    expect(result.evidence.sentence).toMatchObject({
      values: { change: "v2.4.1" },
      count: 18,
    });
  });

  test("a first deploy that did not stop it, then the one that did: judged around the second, the first's failures counted before it", async () => {
    const recorded: {
      result: StepCheckResult | null;
      recorded: RecordingEvidence;
    } = await check({
      minute: 400,
      evidence: {
        attacks: [
          ...BEFORE,
          ...attacks(4, {
            minute: 80,
            outcome: SecurityEventRequestOutcome.ReachedDatabase,
          }),
          ...attacks(12, {
            minute: 200,
            outcome: SecurityEventRequestOutcome.Rejected,
          }),
        ],
        fixChanges: { deploys: [deploy(60), deploy(150, "v2.4.2")] },
      },
    });

    expect(recorded.result!.state).toBe(SecurityCaseStepCheckState.Verified);
    expect(recorded.result!.evidence.sentence).toMatchObject({
      values: { change: "v2.4.2" },
      times: { time: at(150).toISOString() },
      count: 12,
    });
    expect(recorded.result!.evidence.facts).toContainEqual({
      template: CHECK_FIX_FACT_BEFORE_DATABASE,
      values: {},
      numbers: { through: 10 },
      count: 28,
    });
    // Read around the first change, then around the one that fixed it.
    expect(
      recorded.recorded.reads
        .filter((read: { reader: string }): boolean => {
          return read.reader === "readRouteAttacks";
        })
        .map((read: { asked: unknown }): unknown => {
          return (read.asked as { splitAt: Date }).splitAt;
        }),
    ).toEqual([at(60), at(150)]);
  });

  test("Fix With AI's pull request, deployed: the change is named by the deploy's version, and the pull request is one click away", async () => {
    const result: StepCheckResult = await checked({
      minute: 300,
      evidence: {
        attacks: [
          ...BEFORE,
          ...attacks(18, {
            minute: 120,
            outcome: SecurityEventRequestOutcome.Rejected,
          }),
        ],
        fixChanges: {
          pullRequests: [
            pullRequest({
              state: PullRequestState.Merged,
              mergedAt: at(40),
              deployedAt: at(60),
              deployedVersion: "2.4.1",
            }),
          ],
        },
      },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.Verified);
    expect(result.evidence.sentence.values).toEqual({
      route: ROUTE,
      change: "2.4.1",
    });
    expect(result.evidence.links).toContainEqual({
      kind: ResponseLinkKind.OpenProvider,
      provider: "GitHub",
      url: "https://github.com/acme/search/pull/123",
    });
  });
});

describe("no attempts since the fix", () => {
  test("says exactly that, not verified, and how much it waits for", async () => {
    const result: StepCheckResult = await checked({
      minute: 300,
      evidence: { attacks: BEFORE, fixChanges: { deploys: [deploy(60)] } },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.LooksDone);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_FIX_ROUTE_NO_ATTEMPTS,
      values: { route: ROUTE, change: "v2.4.1" },
      times: { time: at(60).toISOString() },
    });
    // "Watching /api/search until 24 Nov: verified once 11 attack requests are kept out of the database."
    expect(result.evidence.facts[0]).toEqual({
      template: CHECK_FIX_FACT_WATCHING_DATABASE,
      values: { route: ROUTE },
      times: {
        until: new Date(
          at(60).getTime() + FIX_ROUTE_WATCH_DAYS * DAY,
        ).toISOString(),
      },
      count: 11,
    });
  });

  test("too few turned away to prove it: looks done, with what proof takes", async () => {
    const result: StepCheckResult = await checked({
      minute: 300,
      evidence: {
        attacks: [
          ...attacks(3, {
            minute: 0,
            outcome: SecurityEventRequestOutcome.ReachedApp,
          }),
          ...attacks(1, {
            minute: 5,
            outcome: SecurityEventRequestOutcome.Rejected,
          }),
          ...attacks(2, {
            minute: 120,
            outcome: SecurityEventRequestOutcome.Rejected,
          }),
        ],
        fixChanges: { deploys: [deploy(60)] },
      },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.LooksDone);
    expect(result.evidence.sentence).toMatchObject({
      template: CHECK_FIX_ROUTE_TURNED_AWAY,
      count: 2,
    });
    expect(result.evidence.facts[0]).toMatchObject({
      template: CHECK_FIX_FACT_WATCHING,
      count: 3,
    });
  });

  test("the watch is over: still looks done, saying too few attacks came", async () => {
    const minute: number = 60 + 8 * 24 * 60;
    const result: StepCheckResult = await checked({
      minute,
      evidence: { attacks: BEFORE, fixChanges: { deploys: [deploy(60)] } },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.LooksDone);
    expect(result.evidence.facts[0]).toMatchObject({
      template: CHECK_FIX_FACT_WATCH_ENDED,
    });
  });

  test("before the fix every attack was turned away too: the attacks cannot show it worked, however many come", async () => {
    const result: StepCheckResult = await checked({
      minute: 300,
      evidence: {
        attacks: [
          ...attacks(10, {
            minute: 0,
            outcome: SecurityEventRequestOutcome.Rejected,
          }),
          ...attacks(40, {
            minute: 120,
            outcome: SecurityEventRequestOutcome.Rejected,
          }),
        ],
        fixChanges: { deploys: [deploy(60)] },
      },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.LooksDone);
    expect(result.evidence.facts[0]).toEqual({
      template: CHECK_FIX_FACT_NONE_BEFORE,
      values: { route: ROUTE },
    });
  });

  test("so few got through before that no number of attacks since proves it", async () => {
    const result: StepCheckResult = await checked({
      minute: 300,
      evidence: {
        attacks: [
          ...attacks(1, {
            minute: 0,
            outcome: SecurityEventRequestOutcome.ReachedApp,
          }),
          ...attacks(99, {
            minute: 1,
            outcome: SecurityEventRequestOutcome.Rejected,
            everyMinutes: 0,
          }),
          ...attacks(200, {
            minute: 120,
            outcome: SecurityEventRequestOutcome.Rejected,
            everyMinutes: 0,
          }),
        ],
        fixChanges: { deploys: [deploy(60)] },
      },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.LooksDone);
    expect(result.evidence.facts[0]).toMatchObject({
      template: CHECK_FIX_FACT_TOO_FEW_BEFORE,
    });
  });

  test("attacks the edge stopped never reached the app: no attempts, and they are said apart", async () => {
    const result: StepCheckResult = await checked({
      minute: 300,
      evidence: {
        attacks: [
          ...BEFORE,
          ...attacks(52, {
            minute: 120,
            outcome: SecurityEventRequestOutcome.Rejected,
            isEdge: true,
            everyMinutes: 0,
          }),
        ],
        fixChanges: { deploys: [deploy(60)] },
      },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.LooksDone);
    expect(result.evidence.sentence.template).toBe(CHECK_FIX_ROUTE_NO_ATTEMPTS);
    expect(result.evidence.facts).toContainEqual({
      template: CHECK_FIX_FACT_EDGE_STOPPED,
      values: { route: ROUTE },
      count: 52,
    });
  });

  test("attacks since that cannot be followed are neither turned away nor through: OneUptime cannot tell", async () => {
    const result: StepCheckResult = await checked({
      minute: 300,
      evidence: {
        attacks: [...BEFORE, ...attacks(5, { minute: 120, outcome: "" })],
        fixChanges: { deploys: [deploy(60)] },
      },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_FIX_CANNOT_NOT_FOLLOWED,
      values: { route: ROUTE, change: "v2.4.1" },
      count: 5,
    });

    const some: StepCheckResult = await checked({
      minute: 300,
      evidence: {
        attacks: [
          ...BEFORE,
          ...attacks(18, {
            minute: 120,
            outcome: SecurityEventRequestOutcome.Rejected,
          }),
          ...attacks(2, { minute: 140, outcome: "" }),
        ],
        fixChanges: { deploys: [deploy(60)] },
      },
    });

    // The ones that were followed prove it; the rest are said.
    expect(some.state).toBe(SecurityCaseStepCheckState.Verified);
    expect(some.evidence.facts).toContainEqual({
      template: CHECK_FIX_FACT_UNFOLLOWED,
      values: {},
      count: 2,
    });
  });
});

describe("nothing shipped yet", () => {
  test("no deploy data at all: OneUptime cannot tell when a fix ships, and says how to let it", async () => {
    const result: StepCheckResult = await checked({
      minute: 300,
      evidence: {
        attacks: BEFORE,
        fixChanges: { deploys: [], hasDeployData: false },
      },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_FIX_CANNOT_NO_DEPLOYS,
      values: { service: "search-api" },
    });
    expect(result.evidence.docsPath).toBe(
      "/telemetry/security-cases#how-oneuptime-checks-a-step",
    );
  });

  test("deploys recorded, none since the case opened: not done", async () => {
    const result: StepCheckResult = await checked({
      minute: 300,
      evidence: {
        attacks: BEFORE,
        fixChanges: { deploys: [], hasDeployData: true },
      },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.NotDone);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_FIX_NOTHING_SHIPPED,
      values: { service: "search-api" },
    });
  });

  test("a merged pull request without a new version: merged is not shipped", async () => {
    const result: StepCheckResult = await checked({
      minute: 300,
      evidence: {
        attacks: BEFORE,
        fixChanges: {
          pullRequests: [
            pullRequest({ state: PullRequestState.Merged, mergedAt: at(40) }),
          ],
          deploys: [],
          hasDeployData: true,
        },
      },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.NotDone);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_FIX_PULL_REQUEST_NOT_SHIPPED,
      values: { pullRequest: "#123" },
      times: { time: at(40).toISOString() },
    });
    expect(result.evidence.links).toEqual([
      {
        kind: ResponseLinkKind.OpenProvider,
        provider: "GitHub",
        url: "https://github.com/acme/search/pull/123",
      },
    ]);
  });

  test("OneUptime AI's fix waiting for review", async () => {
    const result: StepCheckResult = await checked({
      minute: 300,
      evidence: {
        attacks: BEFORE,
        fixChanges: { pullRequests: [pullRequest()], hasDeployData: true },
      },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.NotDone);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_FIX_PULL_REQUEST_OPEN,
      values: { pullRequest: "#123" },
    });
  });

  test("requests that name no service of the app's: OneUptime cannot tell which service ships the fix", async () => {
    const event: SecurityCaseMatchedEventJson = attackEvent();

    const result: StepCheckResult = await checked({
      minute: 300,
      matches: matchesOf([
        {
          ...event,
          attributes: {
            [SECURITY_REQUEST_ATTRIBUTES.url]: "/api/search?q=1",
            [WEB_ATTACK_KIND_ATTRIBUTE]: "sql-injection",
          },
        },
      ]),
      evidence: { attacks: BEFORE },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(result.evidence.sentence).toEqual({
      template: CHECK_FIX_CANNOT_NO_SERVICE,
      values: { route: ROUTE },
    });
  });
});

describe("failing toward a person", () => {
  test("what shipped could not be read: OneUptime cannot tell, never done, and tries again soon", async () => {
    const { result, recorded } = await check({
      minute: 300,
      evidence: { attacks: BEFORE, failing: ["readFixChanges"] },
    });

    expect(result!.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(result!.evidence.sentence.template).toBe(CHECK_CANNOT_READ_FAILED);
    expect(result!.evidence.data).toEqual({ readFailed: true });
    expect(result!.recheckInMinutes).toBe(2);
    expect(
      recorded.reads.map((read: { reader: string }): string => {
        return read.reader;
      }),
    ).toEqual(["readFixChanges"]);
  });

  test("the attacks could not be read", async () => {
    const result: StepCheckResult = await checked({
      minute: 300,
      evidence: {
        attacks: BEFORE,
        fixChanges: { deploys: [deploy(60)] },
        failing: ["readRouteAttacks"],
      },
    });

    expect(result.state).toBe(SecurityCaseStepCheckState.CannotTell);
    expect(result.evidence.data).toEqual({ readFailed: true });
  });

  test("a step that stopped holding stays so through a read that failed", async () => {
    const regressed: StepCheckResult = await checked({
      minute: 210,
      previous: previousCheck({
        stepKey: KEY,
        state: SecurityCaseStepCheckState.LooksDone,
        evidence: (
          await checked({
            minute: 100,
            evidence: {
              attacks: BEFORE,
              fixChanges: { deploys: [deploy(60)] },
            },
          })
        ).evidence,
        stateSince: at(100),
      }),
      evidence: {
        attacks: [
          ...BEFORE,
          ...attacks(1, {
            minute: 200,
            outcome: SecurityEventRequestOutcome.ReachedDatabase,
          }),
        ],
        fixChanges: { deploys: [deploy(60)] },
      },
    });
    const failed: StepCheckResult = await checked({
      minute: 220,
      evidence: { failing: ["readFixChanges"] },
    });

    expect(
      settleStepCheck({
        previous: previousCheck({
          stepKey: KEY,
          state: regressed.state,
          evidence: regressed.evidence,
          stateSince: at(210),
        }),
        result: failed,
        now: at(220),
        intervalInMinutes: FixRouteStepCheck.intervalInMinutes,
      }).state,
    ).toBe(SecurityCaseStepCheckState.Regressed);
  });

  test("a case that names no route, or whose detections cannot be read, is not one this check reads", async () => {
    expect(
      (await check({ minute: 300, evidence: {}, route: "" })).result,
    ).toBeNull();
    expect(
      (await check({ minute: 300, evidence: {}, matches: null })).result,
    ).toBeNull();
  });
});

describe("how much evidence counts as proof", () => {
  test("enough turned away that, had nothing changed, one would almost surely have got through", () => {
    expect(getNeededProof({ harmful: 6, followed: 6 })).toBe(
      FIX_ROUTE_MIN_PROOF,
    );
    expect(getNeededProof({ harmful: 1, followed: 2 })).toBe(5);
    expect(getNeededProof({ harmful: 6, followed: 24 })).toBe(11);
    expect(getNeededProof({ harmful: 1, followed: 10 })).toBe(29);
    // 59 would be needed: too rare to prove.
    expect(getNeededProof({ harmful: 1, followed: 20 })).toBeNull();
    expect(getNeededProof({ harmful: 0, followed: 20 })).toBeNull();
    expect(getNeededProof({ harmful: 0, followed: 0 })).toBeNull();
    expect(FIX_ROUTE_MAX_PROOF).toBe(50);
  });

  test("the chance that many would all be turned away by chance is at most 5%", () => {
    for (const [harmful, followed] of [
      [1, 2],
      [6, 24],
      [1, 10],
      [3, 4],
    ] as Array<[number, number]>) {
      const needed: number = getNeededProof({ harmful, followed })!;
      const rate: number = harmful / followed;

      expect(Math.pow(1 - rate, needed)).toBeLessThanOrEqual(0.05);
      expect(Math.pow(1 - rate, needed - 1) > 0.05 || needed === 3).toBe(true);
    }
  });
});

describe("the changes and the window", () => {
  test("a fix's deploy and the service's own deploy of it are one change, named by its version, with the pull request", () => {
    const changes: Array<ShippedChange> = getShippedChanges({
      since: at(2),
      changes: {
        pullRequests: [
          pullRequest({
            state: PullRequestState.Merged,
            mergedAt: at(40),
            deployedAt: at(60),
            deployedVersion: "",
            deployedCommitSha: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
          }),
          // Closed without merging, and merged but never deployed: nothing shipped.
          pullRequest({ id: "p2", state: PullRequestState.Closed }),
          pullRequest({
            id: "p3",
            state: PullRequestState.Merged,
            mergedAt: at(50),
          }),
        ],
        deploys: [
          deploy(63, "v2.4.1"),
          deploy(200, "v2.4.2"),
          // Before the case opened: nothing to do with its fix.
          deploy(1, "v2.4.0"),
        ],
        hasDeployData: true,
        serviceNames: NAMES,
      },
    });

    expect(
      changes.map((change: ShippedChange): unknown => {
        return {
          time: change.time,
          label: change.label,
          pullRequest: change.pullRequest?.number || null,
        };
      }),
    ).toEqual([
      // The fix's deploy named no version: the service's deploy of it does.
      { time: at(60), label: "v2.4.1", pullRequest: 123 },
      { time: at(200), label: "v2.4.2", pullRequest: null },
    ]);

    // Alone, a deployed fix that names no version is named by its pull request.
    expect(
      getShippedChanges({
        since: at(2),
        changes: {
          pullRequests: [
            pullRequest({
              state: PullRequestState.Merged,
              mergedAt: at(40),
              deployedAt: at(60),
            }),
          ],
          deploys: [],
          hasDeployData: false,
          serviceNames: {},
        },
      })[0]!.label,
    ).toBe("#123");
  });

  test("the fixing change is the earliest whose rollout was over by the last attack that got through", () => {
    const changes: Array<ShippedChange> = [60, 150, 300].map(
      (minute: number): ShippedChange => {
        return { time: at(minute), label: `${minute}`, pullRequest: null };
      },
    );

    expect(pickFixingChange({ changes, lastHarmAt: null })).toBe(0);
    expect(pickFixingChange({ changes, lastHarmAt: at(65) })).toBe(0);
    expect(pickFixingChange({ changes, lastHarmAt: at(70) })).toBe(1);
    expect(pickFixingChange({ changes, lastHarmAt: at(400) })).toBe(-1);
  });

  test("the attacks are read from an hour before the first detection, at most 30 days back", () => {
    expect(
      getFixRouteWindow({
        securityCase: { firstDetectedAt: DETECTED_AT, createdAt: at(2) },
        now: at(300),
      }),
    ).toEqual({ start: at(-60), end: at(300) });
    expect(
      getFixRouteWindow({
        securityCase: { firstDetectedAt: DETECTED_AT, createdAt: at(2) },
        now: at(60 * 24 * 40),
      }).start,
    ).toEqual(at(60 * 24 * 10));
  });
});

describe("the same kind of attack on the same route", () => {
  test("is the opening detection's route, kinds and services", () => {
    expect(getRouteAttackScope({ matches: matchesOf(), route: ROUTE })).toEqual(
      {
        route: ROUTE,
        match: { kind: RouteMatchKind.Exact, path: ROUTE },
        kinds: ["sql-injection"],
        serviceIds: [SERVICE_ID],
      },
    );
    expect(getRouteAttackScope({ matches: null, route: ROUTE })).toBeNull();
    expect(
      getRouteAttackScope({ matches: matchesOf(), route: " " }),
    ).toBeNull();
  });

  test("a route that carries a traversal is matched by the part before it, never the whole site", () => {
    expect(getRouteMatch("/static/../../etc/passwd")).toEqual({
      kind: RouteMatchKind.Prefix,
      path: "/static/",
    });
    expect(getRouteMatch("/files/%2e%2e/%2e%2e/etc/passwd")).toEqual({
      kind: RouteMatchKind.Prefix,
      path: "/files/",
    });
    expect(getRouteMatch("/../etc/passwd")).toEqual({
      kind: RouteMatchKind.Exact,
      path: "/../etc/passwd",
    });
    expect(
      isPathOnRoute("/static/..%2f..%2fwin.ini", getRouteMatch("/static/../x")),
    ).toBe(true);
    expect(isPathOnRoute("/api/search/", getRouteMatch(ROUTE))).toBe(true);
    expect(isPathOnRoute("/api/searches", getRouteMatch(ROUTE))).toBe(false);
  });

  test("the route's requests are read whatever else the detection matched", () => {
    const other: SecurityCaseMatchedEventJson = attackEvent({
      eventUid: "event-2",
      attributes: {
        [SECURITY_REQUEST_ATTRIBUTES.url]: "/login?u=admin'--",
        [WEB_ATTACK_KIND_ATTRIBUTE]: "path-traversal",
        [SECURITY_LOG_RESOURCE_ID_ATTRIBUTE]:
          "88888888-8888-4888-8888-888888888888",
        "oneuptime.log.resource.type": ServiceType.OpenTelemetry,
      },
    });

    expect(
      getRouteAttackScope({
        matches: matchesOf([attackEvent(), other]),
        route: ROUTE,
      }),
    ).toMatchObject({ kinds: ["sql-injection"], serviceIds: [SERVICE_ID] });
  });
});
