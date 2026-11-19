import { beforeAll, describe, expect, test } from "@jest/globals";
import SecurityCaseTask from "Common/Models/DatabaseModels/SecurityCaseTask";
import SecurityPlaybook from "Common/Models/DatabaseModels/SecurityPlaybook";
import User from "Common/Models/DatabaseModels/User";
import Route from "Common/Types/API/Route";
import SecurityCaseAiVerdict from "Common/Types/SecurityCase/SecurityCaseAiVerdict";
import {
  SecurityCaseMatchBasis,
  SecurityCaseMatchRuleJson,
  SecurityCaseMatchedDetectionJson,
  SecurityCaseMatchedEventJson,
  SecurityCaseMatchesJson,
} from "Common/Types/SecurityCase/SecurityCaseMatches";
import SecurityCaseStage from "Common/Types/SecurityCase/SecurityCaseStage";
import {
  SecurityEntity,
  SecurityEntityType,
} from "Common/Types/SecurityCase/SecurityEntity";
import SecurityEventRequestOutcome from "Common/Types/SecurityEvent/SecurityEventRequestOutcome";
import { SecurityPlaybookActionType } from "Common/Types/SecurityPlaybook/SecurityPlaybookAction";
import { PillTone } from "Common/UI/Components/Pill/PillTone";

/*
 * A case's Response Plan (#9557): what to do about the case now - confirm
 * it, contain it, fix what let it happen, close it - each step concrete to
 * the case: its addresses, users and hosts, how far its requests got, what
 * its rule says it also fires on, the ATT&CK tactics its detections map
 * to, the playbooks the project has and what OneUptime AI suggests. A step
 * OneUptime can do has its button; one it cannot is done outside it. A step
 * is done when the case says so, or when somebody ticks it off - a task
 * that keeps the step's key.
 */

type Plan =
  typeof import("../../FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponsePlan");
type Types =
  typeof import("../../FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponseTypes");
type Copy =
  typeof import("../../FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponseCopy");
type Data =
  typeof import("../../FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponseData");

let plan: Plan;
let types: Types;
let copy: Copy;
let data: Data;

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const BASE: string = `/dashboard/${PROJECT_ID}`;
const RULE_ID: string = "44444444-4444-4444-8444-444444444444";
const OKTA_PLAYBOOK_ID: string = "77777777-7777-4777-8777-777777777777";
const ENRICH_PLAYBOOK_ID: string = "88888888-8888-4888-8888-888888888888";
const CROWDSTRIKE_PLAYBOOK_ID: string = "99999999-9999-4999-8999-999999999999";

beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: {
      pathname: `${BASE}/security-events/cases`,
      search: "",
      hash: "",
    },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op; these tests never navigate.
      },
    },
  };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  plan = await import(
    "../../FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponsePlan"
  );
  types = await import(
    "../../FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponseTypes"
  );
  copy = await import(
    "../../FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponseCopy"
  );
  data = await import(
    "../../FeatureSet/Dashboard/src/Components/SecurityCase/Response/SecurityCaseResponseData"
  );
});

function rule(
  overrides: Partial<SecurityCaseMatchRuleJson> = {},
): SecurityCaseMatchRuleJson {
  return {
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
    falsePositives: ["Vulnerability scanners your team runs"],
    references: [],
    lookFor: [],
    ...overrides,
  };
}

function event(
  overrides: Partial<SecurityCaseMatchedEventJson> = {},
): SecurityCaseMatchedEventJson {
  return {
    time: "2026-11-17T19:22:14.000Z",
    eventUid: "log:abc:0",
    sourceId: "",
    severityName: "Medium",
    className: "HTTP Activity",
    categoryName: "",
    activityName: "",
    statusName: "",
    message: "Path traversal attempt",
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
    mitreTactics: [],
    mitreTechniques: [],
    attributes: {
      "url.original":
        "https://oneuptime.example/api/w/admins/jobs_u/get_log_file/../../proc/self/environ?x=1",
    },
    traceId: "trace-1",
    spanId: "",
    sessionId: "",
    requestOutcome: SecurityEventRequestOutcome.Rejected,
    hunt: null,
    ...overrides,
  };
}

function detection(
  overrides: Partial<SecurityCaseMatchedDetectionJson> = {},
): SecurityCaseMatchedDetectionJson {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    source: "Detection Rule",
    title: "Path traversal attempts — 35.196.249.14",
    severity: "Medium",
    groupValue: "35.196.249.14",
    ruleName: "Path traversal attempts",
    eventCount: 12,
    fireCount: 1,
    firstSeenAt: "2026-11-17T19:28:00.000Z",
    lastSeenAt: "2026-11-17T19:28:00.000Z",
    sampleMessage: "",
    isOpening: true,
    rule: rule(),
    threatIntelFeedId: "",
    securityEventConnectionId: "",
    basis: SecurityCaseMatchBasis.RuleCondition,
    windowStart: "2026-11-17T19:22:00.000Z",
    windowEnd: "2026-11-17T19:29:00.000Z",
    events: [event()],
    matchedEventCount: 12,
    outcomes: { [SecurityEventRequestOutcome.Rejected]: 12 },
    ...overrides,
  };
}

function matches(
  opening: SecurityCaseMatchedDetectionJson = detection(),
): SecurityCaseMatchesJson {
  return {
    detections: [opening],
    detectionCount: 1,
    unreadableSources: [],
    failedSources: [],
  };
}

type PlanInput = Parameters<Plan["buildResponsePlan"]>[0];

// CASE-52: a public scanner's path traversal, nobody on it yet.
function input(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    entities: [{ type: SecurityEntityType.IpAddress, value: "35.196.249.14" }],
    mitreTactics: ["TA0001"],
    mitreTechniques: ["T1190"],
    isAssigned: false,
    hasIncident: false,
    stage: SecurityCaseStage.New,
    hasContainedStatus: true,
    matches: matches(),
    playbooks: [],
    ranPlaybookIds: [],
    tasks: [],
    ai: null,
    ...overrides,
  };
}

function keys(built: ReturnType<Plan["buildResponsePlan"]>): Array<string> {
  return built.steps.map((step: { key: string }): string => {
    return step.key;
  });
}

function step(
  built: ReturnType<Plan["buildResponsePlan"]>,
  key: string,
): ReturnType<Plan["buildResponsePlan"]>["steps"][number] {
  const found:
    | ReturnType<Plan["buildResponsePlan"]>["steps"][number]
    | undefined = built.steps.find((candidate: { key: string }): boolean => {
    return candidate.key === key;
  });

  expect({ key, found: Boolean(found) }).toEqual({ key, found: true });

  return found!;
}

describe("a public scanner's path traversal (CASE-52)", () => {
  test("confirms, contains, fixes and closes, in that order, each step concrete to the case", () => {
    const built: ReturnType<Plan["buildResponsePlan"]> =
      plan.buildResponsePlan(input());

    expect(keys(built)).toEqual([
      "confirm:take",
      "confirm:requests",
      `confirm:false-positive:${RULE_ID}`,
      "contain:block-ip:35.196.249.14",
      "contain:incident",
      "contain:mark-contained",
      "fix:public-app",
      "close",
    ]);
    expect(built.total).toBe(8);
    expect(built.done).toBe(0);
  });

  test("blocking the address is done outside OneUptime, with the address one click from the clipboard", () => {
    const block: ReturnType<typeof step> = step(
      plan.buildResponsePlan(input()),
      "contain:block-ip:35.196.249.14",
    );

    expect(block.text).toEqual({
      template: copy.STEP_BLOCK_PUBLIC_IP,
      values: { value: "35.196.249.14" },
    });
    expect(block.isOutsideOneUptime).toBe(true);
    expect(block.copyValue).toBe("35.196.249.14");
    expect(block.action).toBeUndefined();
    expect(block.completion).toBe(types.ResponseStepCompletion.ByTask);
  });

  test("checks the requests: every one turned away, the events naming the address one click away", () => {
    const requests: ReturnType<typeof step> = step(
      plan.buildResponsePlan(input()),
      "confirm:requests",
    );

    expect(requests.text).toEqual({
      template: copy.STEP_REQUESTS_TURNED_AWAY,
      values: { value: "35.196.249.14" },
    });
    expect(requests.detail?.count).toBe(12);
    expect(requests.action?.kind).toBe(types.ResponseActionKind.OpenRoute);
    expect(requests.action?.route?.toString()).toContain(
      "observable%3A35.196.249.14",
    );
  });

  test("rules out a false positive with what the rule says it also fires on, and an exception for the address", () => {
    const falsePositive: ReturnType<typeof step> = step(
      plan.buildResponsePlan(input()),
      `confirm:false-positive:${RULE_ID}`,
    );

    expect(falsePositive.text).toEqual({
      template: copy.STEP_FALSE_POSITIVE_VALUE,
      values: { value: "35.196.249.14" },
    });
    expect(falsePositive.quotes).toEqual([
      "Vulnerability scanners your team runs",
    ]);
    expect(falsePositive.action).toEqual({
      kind: types.ResponseActionKind.AddRuleException,
      title: copy.ACTION_ADD_EXCEPTION,
      detectionRuleId: RULE_ID,
      entity: { type: SecurityEntityType.IpAddress, value: "35.196.249.14" },
    });
  });

  test("fixes the route the requests went to, without its host or query", () => {
    expect(
      step(plan.buildResponsePlan(input()), "fix:public-app").text,
    ).toEqual({
      template: copy.STEP_FIX_PUBLIC_APP_ROUTE,
      values: {
        route: "/api/w/admins/jobs_u/get_log_file/../../proc/self/environ",
      },
    });
  });

  test("the case's own moves have its buttons, and nobody ticks them off", () => {
    const built: ReturnType<Plan["buildResponsePlan"]> =
      plan.buildResponsePlan(input());

    for (const [key, kind] of [
      ["confirm:take", types.ResponseActionKind.AssignToMe],
      ["contain:incident", types.ResponseActionKind.DeclareIncident],
      ["contain:mark-contained", types.ResponseActionKind.MarkContained],
      ["close", types.ResponseActionKind.CloseCase],
    ] as Array<[string, string]>) {
      const found: ReturnType<typeof step> = step(built, key);

      expect([key, found.action?.kind]).toEqual([key, kind]);
      expect([key, found.completion]).toEqual([
        key,
        types.ResponseStepCompletion.ByCase,
      ]);
    }
  });
});

describe("what is done", () => {
  test("the case says so: assigned, an incident declared, contained", () => {
    const built: ReturnType<Plan["buildResponsePlan"]> = plan.buildResponsePlan(
      input({
        isAssigned: true,
        hasIncident: true,
        stage: SecurityCaseStage.Contained,
      }),
    );

    for (const key of [
      "confirm:take",
      "contain:incident",
      "contain:mark-contained",
    ]) {
      expect([key, step(built, key).isDone]).toEqual([key, true]);
      // Nothing left to press on a step that is done.
      expect([key, step(built, key).action]).toEqual([key, undefined]);
    }

    expect(step(built, "close").isDone).toBe(false);
    expect(built.done).toBe(3);
  });

  test("a step ticked off is a task that keeps its key: done, by whom and when", () => {
    const doneAt: Date = new Date("2026-11-17T20:00:00.000Z");
    const built: ReturnType<Plan["buildResponsePlan"]> = plan.buildResponsePlan(
      input({
        tasks: [
          {
            id: "task-1",
            responseStepKey: "contain:block-ip:35.196.249.14",
            isDone: true,
            doneAt,
            doneByName: "Kim Morgan",
          },
          {
            id: "task-2",
            responseStepKey: "fix:public-app",
            isDone: false,
          },
        ],
      }),
    );

    const block: ReturnType<typeof step> = step(
      built,
      "contain:block-ip:35.196.249.14",
    );

    expect(block.isDone).toBe(true);
    expect(block.taskId).toBe("task-1");
    expect(block.doneByName).toBe("Kim Morgan");
    expect(block.doneAt).toBe(doneAt);

    const fix: ReturnType<typeof step> = step(built, "fix:public-app");

    // Its task is open again: not done, ticked on the same task.
    expect(fix.isDone).toBe(false);
    expect(fix.taskId).toBe("task-2");
    expect(fix.doneByName).toBeUndefined();
  });

  test("a step ticked twice reads done when either task is", () => {
    const built: ReturnType<Plan["buildResponsePlan"]> = plan.buildResponsePlan(
      input({
        tasks: [
          { id: "a", responseStepKey: "fix:public-app", isDone: false },
          { id: "b", responseStepKey: "fix:public-app", isDone: true },
        ],
      }),
    );

    expect(step(built, "fix:public-app").isDone).toBe(true);
    expect(step(built, "fix:public-app").taskId).toBe("b");
  });

  test("a task with another step's key, or none, ticks nothing off; the case's own moves take no task", () => {
    const built: ReturnType<Plan["buildResponsePlan"]> = plan.buildResponsePlan(
      input({
        tasks: [
          { id: "a", responseStepKey: "confirm:take", isDone: true },
          { id: "b", responseStepKey: "someone-else's", isDone: true },
        ],
      }),
    );

    expect(step(built, "confirm:take").isDone).toBe(false);
    expect(step(built, "confirm:take").taskId).toBeUndefined();
    expect(built.done).toBe(0);
  });

  test("a closed case is done with: its close step is done, and nothing more is pressed", () => {
    const built: ReturnType<Plan["buildResponsePlan"]> = plan.buildResponsePlan(
      input({ stage: SecurityCaseStage.Closed }),
    );

    expect(step(built, "close").isDone).toBe(true);
    expect(step(built, "confirm:take").isDone).toBe(true);
    expect(
      built.steps.filter((candidate: { action?: unknown }): boolean => {
        return Boolean(candidate.action);
      }),
    ).toEqual([]);
  });
});

describe("marking the case contained", () => {
  test("is offered once every step that contains it is done", () => {
    const notYet: ReturnType<Plan["buildResponsePlan"]> =
      plan.buildResponsePlan(input());

    expect(notYet.isReadyToMarkContained).toBe(false);

    const ready: ReturnType<Plan["buildResponsePlan"]> = plan.buildResponsePlan(
      input({
        tasks: [
          {
            id: "a",
            responseStepKey: "contain:block-ip:35.196.249.14",
            isDone: true,
          },
        ],
      }),
    );

    // Declaring an incident is for when customers are affected: it never holds it up.
    expect(ready.isReadyToMarkContained).toBe(true);
  });

  test("is not offered once the case is contained, nor without a status to contain it in, nor with nothing to contain", () => {
    const tasks: PlanInput["tasks"] = [
      {
        id: "a",
        responseStepKey: "contain:block-ip:35.196.249.14",
        isDone: true,
      },
    ];

    expect(
      plan.buildResponsePlan(
        input({ tasks, stage: SecurityCaseStage.Contained }),
      ).isReadyToMarkContained,
    ).toBe(false);

    const noStatus: ReturnType<Plan["buildResponsePlan"]> =
      plan.buildResponsePlan(input({ tasks, hasContainedStatus: false }));

    expect(noStatus.isReadyToMarkContained).toBe(false);
    expect(keys(noStatus)).not.toContain("contain:mark-contained");

    expect(
      plan.buildResponsePlan(input({ entities: [], matches: null }))
        .isReadyToMarkContained,
    ).toBe(false);
  });
});

describe("containing what the case is about", () => {
  test("an account through the playbook that suspends it, done once the playbook ran", () => {
    const playbooks: PlanInput["playbooks"] = [
      {
        id: OKTA_PLAYBOOK_ID,
        name: "Suspend in Okta",
        actions: [SecurityPlaybookActionType.SuspendOktaUser],
      },
    ];
    const entities: Array<SecurityEntity> = [
      { type: SecurityEntityType.User, value: "k.morgan@acme.example" },
    ];

    const before: ReturnType<typeof step> = step(
      plan.buildResponsePlan(input({ entities, playbooks })),
      "contain:user:k.morgan@acme.example",
    );

    expect(before.text).toEqual({
      template: copy.STEP_CONTAIN_USER_PLAYBOOK,
      values: { value: "k.morgan@acme.example", playbook: "Suspend in Okta" },
    });
    expect(before.action).toEqual({
      kind: types.ResponseActionKind.RunPlaybook,
      title: copy.ACTION_RUN_PLAYBOOK,
      playbookId: OKTA_PLAYBOOK_ID,
    });
    expect(before.isOutsideOneUptime).toBe(false);
    expect(before.completion).toBe(types.ResponseStepCompletion.ByTask);

    const after: ReturnType<typeof step> = step(
      plan.buildResponsePlan(
        input({ entities, playbooks, ranPlaybookIds: [OKTA_PLAYBOOK_ID] }),
      ),
      "contain:user:k.morgan@acme.example",
    );

    expect(after.isDone).toBe(true);
    expect(after.completion).toBe(types.ResponseStepCompletion.ByCase);
  });

  /*
   * Regression: any run of the playbook ticked the step off - one held for
   * an approval nobody gave, or one that failed - so the plan said the
   * account was suspended, and offered to mark the case Contained.
   */
  test("a playbook's step is done only once a run of it succeeded: one held or still going says so with no second Run Playbook, a failed one can be run again", () => {
    const playbooks: PlanInput["playbooks"] = [
      {
        id: OKTA_PLAYBOOK_ID,
        name: "Suspend in Okta",
        actions: [SecurityPlaybookActionType.SuspendOktaUser],
      },
    ];
    const entities: Array<SecurityEntity> = [
      { type: SecurityEntityType.User, value: "k.morgan@acme.example" },
    ];
    const containing: (
      runs: Array<{ playbookId: string; status: string }>,
    ) => ReturnType<typeof step> = (
      runs: Array<{ playbookId: string; status: string }>,
    ): ReturnType<typeof step> => {
      return step(
        plan.buildResponsePlan(
          input({ entities, playbooks, ...plan.readPlaybookRuns(runs) }),
        ),
        "contain:user:k.morgan@acme.example",
      );
    };

    const held: ReturnType<typeof step> = containing([
      { playbookId: OKTA_PLAYBOOK_ID, status: "Waiting for Approval" },
    ]);

    expect(held.isDone).toBe(false);
    expect(held.action).toBeUndefined();
    expect(held.detail).toEqual({
      template: copy.STEP_RUN_WAITING,
      values: {},
    });

    const going: ReturnType<typeof step> = containing([
      { playbookId: OKTA_PLAYBOOK_ID, status: "Running" },
    ]);

    expect(going.isDone).toBe(false);
    expect(going.action).toBeUndefined();
    expect(going.detail).toEqual({
      template: copy.STEP_RUN_RUNNING,
      values: {},
    });

    const failed: ReturnType<typeof step> = containing([
      { playbookId: OKTA_PLAYBOOK_ID, status: "Failed" },
    ]);

    expect(failed.isDone).toBe(false);
    expect(failed.action?.kind).toBe(types.ResponseActionKind.RunPlaybook);
    expect(failed.detail).toEqual({
      template: copy.STEP_RUN_FAILED,
      values: {},
    });
    expect(failed.isDetailWarning).toBe(true);

    // Run again after it failed, and succeeded: done, whatever came before.
    const succeeded: ReturnType<typeof step> = containing([
      { playbookId: OKTA_PLAYBOOK_ID, status: "Succeeded" },
      { playbookId: OKTA_PLAYBOOK_ID, status: "Failed" },
    ]);

    expect(succeeded.isDone).toBe(true);
    expect(succeeded.detail).toBeUndefined();
  });

  test("the case's runs, newest first: a playbook ran once a run of it succeeded; the latest of the others says where it stands, a cancelled one nothing", () => {
    expect(
      plan.readPlaybookRuns([
        { playbookId: "a", status: "Failed" },
        { playbookId: "a", status: "Succeeded" },
        { playbookId: "b", status: "Waiting for Approval" },
        { playbookId: "b", status: "Failed" },
        { playbookId: "c", status: "Queued" },
        { playbookId: "d", status: "Failed" },
        { playbookId: "e", status: "Cancelled" },
        { playbookId: "", status: "Succeeded" },
      ]),
    ).toEqual({
      ranPlaybookIds: ["a"],
      playbookRunStates: {
        b: types.ResponsePlaybookRunState.Waiting,
        c: types.ResponsePlaybookRunState.Running,
        d: types.ResponsePlaybookRunState.Failed,
      },
    });
  });

  test("an account or a host with no playbook for it, by hand", () => {
    const built: ReturnType<Plan["buildResponsePlan"]> = plan.buildResponsePlan(
      input({
        entities: [
          { type: SecurityEntityType.User, value: "ana" },
          { type: SecurityEntityType.Host, value: "web-03" },
        ],
        matches: null,
      }),
    );

    expect(step(built, "contain:user:ana").text.template).toBe(
      copy.STEP_CONTAIN_USER,
    );
    expect(step(built, "contain:user:ana").isOutsideOneUptime).toBe(true);
    expect(step(built, "contain:host:web-03").text.template).toBe(
      copy.STEP_CONTAIN_HOST,
    );
  });

  test("a host through the playbook that cuts it off, the one OneUptime AI suggests first", () => {
    const built: ReturnType<Plan["buildResponsePlan"]> = plan.buildResponsePlan(
      input({
        entities: [{ type: SecurityEntityType.Host, value: "web-03" }],
        matches: null,
        playbooks: [
          {
            id: "other",
            name: "Isolate in Defender",
            actions: [SecurityPlaybookActionType.IsolateDefenderDevice],
          },
          {
            id: CROWDSTRIKE_PLAYBOOK_ID,
            name: "Contain in CrowdStrike",
            actions: [SecurityPlaybookActionType.ContainCrowdStrikeHost],
          },
        ],
        ai: { suggestedPlaybookId: CROWDSTRIKE_PLAYBOOK_ID },
      }),
    );

    expect(step(built, "contain:host:web-03").action?.playbookId).toBe(
      CROWDSTRIKE_PLAYBOOK_ID,
    );
    // The suggested playbook runs in that step: no second step for it.
    expect(keys(built)).not.toContain(`playbook:${CROWDSTRIKE_PLAYBOOK_ID}`);
  });

  test("a private address is found and taken off the network; an address that names no machine is left out", () => {
    const built: ReturnType<Plan["buildResponsePlan"]> = plan.buildResponsePlan(
      input({
        entities: [
          { type: SecurityEntityType.IpAddress, value: "10.0.3.17" },
          { type: SecurityEntityType.IpAddress, value: "127.0.0.1" },
        ],
        matches: null,
      }),
    );

    expect(step(built, "contain:find-ip:10.0.3.17").text.template).toBe(
      copy.STEP_ISOLATE_PRIVATE_IP,
    );
    expect(keys(built)).not.toContain("contain:find-ip:127.0.0.1");
    expect(keys(built)).not.toContain("contain:block-ip:127.0.0.1");
  });

  test("a domain is blocked and a file quarantined, each by hand; a process or a URL takes no step of its own", () => {
    const built: ReturnType<Plan["buildResponsePlan"]> = plan.buildResponsePlan(
      input({
        entities: [
          { type: SecurityEntityType.Domain, value: "evil.example" },
          {
            type: SecurityEntityType.FileHash,
            value: "d41d8cd98f00b204e9800998ecf8427e",
          },
          { type: SecurityEntityType.Process, value: "powershell.exe" },
          { type: SecurityEntityType.Url, value: "https://x.example/a" },
        ],
        matches: null,
      }),
    );

    expect(step(built, "contain:block-domain:evil.example").copyValue).toBe(
      "evil.example",
    );
    expect(
      step(built, "contain:quarantine-file:d41d8cd98f00b204e9800998ecf8427e")
        .isOutsideOneUptime,
    ).toBe(true);
    expect(
      keys(built).filter((key: string): boolean => {
        return key.includes("powershell") || key.includes("x.example");
      }),
    ).toEqual([]);
  });

  test("the detection's own address first, each value once whatever its case, at most four", () => {
    const entities: Array<SecurityEntity> = [
      { type: SecurityEntityType.IpAddress, value: "203.0.113.1" },
      { type: SecurityEntityType.IpAddress, value: "35.196.249.14" },
      { type: SecurityEntityType.Domain, value: "A.example" },
      { type: SecurityEntityType.Domain, value: "a.example" },
      { type: SecurityEntityType.Domain, value: "b.example" },
      { type: SecurityEntityType.Domain, value: "c.example" },
    ];

    expect(
      plan
        .getContainEntities({ opening: detection(), entities })
        .map((entity: SecurityEntity): string => {
          return entity.value;
        }),
    ).toEqual(["35.196.249.14", "203.0.113.1", "A.example", "b.example"]);
  });
});

describe("the requests", () => {
  test("some got through: open the traces of those that did, said as a warning", () => {
    const opening: SecurityCaseMatchedDetectionJson = detection({
      events: [
        event({ traceId: "through", requestOutcome: "Reached App" }),
        event({ traceId: "away" }),
      ],
      outcomes: { Rejected: 11, "Reached App": 1 },
    });
    const requests: ReturnType<typeof step> = step(
      plan.buildResponsePlan(input({ matches: matches(opening) })),
      "confirm:requests",
    );

    expect(requests.text.template).toBe(copy.STEP_REQUESTS_THROUGH);
    expect(requests.isDetailWarning).toBe(true);
    expect(requests.detail?.numbers).toEqual({ through: 1 });
    expect(requests.detail?.count).toBe(12);
    expect(requests.action?.route?.toString()).toContain("through");
    expect(requests.action?.route?.toString()).not.toContain("away");
  });

  test("none followed into its trace: open their traces to check", () => {
    const requests: ReturnType<typeof step> = step(
      plan.buildResponsePlan(
        input({ matches: matches(detection({ outcomes: {} })) }),
      ),
      "confirm:requests",
    );

    expect(requests.text.template).toBe(copy.STEP_REQUESTS_UNKNOWN);
    expect(requests.action?.title).toBe(copy.ACTION_OPEN_TRACES);
  });

  test("no requests at all take no step", () => {
    expect(
      keys(
        plan.buildResponsePlan(
          input({
            matches: matches(
              detection({ outcomes: {}, events: [event({ traceId: "" })] }),
            ),
          }),
        ),
      ),
    ).not.toContain("confirm:requests");
  });

  test("the route most of them went to, from its route or its address", () => {
    expect(
      plan.getRequestedRoute([
        event({ attributes: { "http.route": "/api/files/:name" } }),
        event({ attributes: { "url.original": "/a?q=1" } }),
        event({ attributes: { "url.original": "/a#frag" } }),
        event({ attributes: {} }),
      ]),
    ).toBe("/a");
    expect(plan.getRequestedRoute([])).toBe("");
  });
});

describe("rules and what fired", () => {
  test("only a rule's detection rules out a false positive with an exception", () => {
    expect(
      keys(
        plan.buildResponsePlan(
          input({
            matches: matches(detection({ source: "Threat Intel", rule: null })),
          }),
        ),
      ).some((key: string): boolean => {
        return key.startsWith("confirm:false-positive");
      }),
    ).toBe(false);
  });

  test("a case its detections name nothing for still rules it out, without a value", () => {
    const built: ReturnType<Plan["buildResponsePlan"]> = plan.buildResponsePlan(
      input({
        entities: [],
        matches: matches(detection({ groupValue: "" })),
      }),
    );

    expect(step(built, `confirm:false-positive:${RULE_ID}`).text).toEqual({
      template: copy.STEP_FALSE_POSITIVE,
      values: {},
    });
  });
});

describe("fixing what let it happen", () => {
  test("from the ATT&CK tactics and techniques: the worst first, at most two, a technique counting its sub-techniques", () => {
    const built: ReturnType<Plan["buildResponsePlan"]> = plan.buildResponsePlan(
      input({
        mitreTactics: ["TA0006", "TA0040", "TA0007"],
        mitreTechniques: ["T1110.003"],
        matches: null,
        entities: [],
      }),
    );

    expect(
      keys(built).filter((key: string): boolean => {
        return key.startsWith("fix:");
      }),
    ).toEqual(["fix:impact", "fix:brute-force"]);
  });

  test("a stolen account's password reset, by its name when the case names one", () => {
    const built: ReturnType<Plan["buildResponsePlan"]> = plan.buildResponsePlan(
      input({
        mitreTactics: ["TA0006"],
        mitreTechniques: ["T1078.004"],
        matches: null,
        entities: [{ type: SecurityEntityType.User, value: "ana" }],
      }),
    );

    expect(step(built, "fix:credentials").text).toEqual({
      template: copy.STEP_FIX_CREDENTIALS_VALUE,
      values: { value: "ana" },
    });
  });

  test("a public app with no route the requests went to says so without one; a case with no tactic gets the plain fix", () => {
    expect(
      step(plan.buildResponsePlan(input({ matches: null })), "fix:public-app")
        .text.template,
    ).toBe(copy.STEP_FIX_PUBLIC_APP);

    expect(
      keys(
        plan.buildResponsePlan(
          input({ mitreTactics: [], mitreTechniques: [], matches: null }),
        ),
      ),
    ).toContain("fix:general");
  });
});

describe("OneUptime AI", () => {
  const REPORT: string = `## Security Case Triage

**Summary** - A scanner probed nginx [C1].

**Assessment** - Likely malicious [C2].

**Suggested next steps**
1. Block **35.196.249.14** at the WAF [C1, C3].
2. Check \`/proc/self/environ\` is not readable by the app [C5].
- Block 35.196.249.14 at the waf [C1].
- See [the OWASP page](https://owasp.org) on path traversal.
`;

  test("its suggested steps, in its words: no list marker, citation, emphasis or link markup, each once", () => {
    expect(plan.readAiSuggestedSteps(REPORT)).toEqual([
      "Block 35.196.249.14 at the WAF.",
      "Check /proc/self/environ is not readable by the app.",
      "See the OWASP page on path traversal.",
    ]);
  });

  test("a section written as a paragraph is one step; a report with none gives none", () => {
    expect(
      plan.readAiSuggestedSteps(
        "**Summary** - x.\n\n**Suggested next steps** - Block the address and watch for more.",
      ),
    ).toEqual(["Block the address and watch for more."]);
    expect(plan.readAiSuggestedSteps("**Summary** - x.")).toEqual([]);
    expect(plan.readAiSuggestedSteps(undefined)).toEqual([]);
    expect(plan.readAiSuggestedSteps("")).toEqual([]);
  });

  test("never a decision line, and at most five, each cut to its length", () => {
    const many: string = Array.from({ length: 8 }, (_: unknown, i: number) => {
      return `- Step ${i} ${"z".repeat(400)}`;
    }).join("\n");
    const steps: Array<string> = plan.readAiSuggestedSteps(
      `**Summary** - x.\n\n**Suggested next steps**\n- Verdict: malicious\n${many}`,
    );

    expect(steps).toHaveLength(plan.RESPONSE_MAX_AI_STEPS);
    expect(steps[0]!.startsWith("Step 0")).toBe(true);
    expect(steps[0]).toHaveLength(plan.RESPONSE_AI_STEP_MAX_LENGTH);
  });

  /*
   * A decision line is what the server reads as one
   * (isSecurityCaseTriageDecisionLine): any case, "=" for ":", in "**" or
   * not. A step that only starts with one of its words is a step.
   */
  test("never a decision line, in any shape the server reads one", () => {
    expect(
      plan.readAiSuggestedSteps(
        "**Summary** - x.\n\n**Suggested next steps**\n- **Verdict:** malicious\n- PRIORITY = high\n- Playbook : none\n- Verdicts on this host are kept for a year.\n- Block the address.",
      ),
    ).toEqual([
      "Verdicts on this host are kept for a year.",
      "Block the address.",
    ]);
  });

  test("its steps join the plan as its own, ticked off as any other", () => {
    const built: ReturnType<Plan["buildResponsePlan"]> = plan.buildResponsePlan(
      input({ ai: { report: REPORT } }),
    );
    const aiSteps: Array<ReturnType<typeof step>> = built.steps.filter(
      plan.isAiStep,
    );

    expect(aiSteps).toHaveLength(3);
    expect(aiSteps[0]!.aiText).toBe("Block 35.196.249.14 at the WAF.");
    expect(aiSteps[0]!.completion).toBe(types.ResponseStepCompletion.ByTask);
    expect(aiSteps[0]!.key.startsWith("ai:")).toBe(true);
    // Before the close: the plan ends where the case does.
    expect(keys(built)[keys(built).length - 1]).toBe("close");
  });

  test("the playbook it suggests: with the checks when it contains nothing, done once it ran", () => {
    const playbooks: PlanInput["playbooks"] = [
      {
        id: ENRICH_PLAYBOOK_ID,
        name: "Enrich New Cases",
        actions: [SecurityPlaybookActionType.CheckThreatIntel],
      },
    ];
    const built: ReturnType<Plan["buildResponsePlan"]> = plan.buildResponsePlan(
      input({ playbooks, ai: { suggestedPlaybookId: ENRICH_PLAYBOOK_ID } }),
    );
    const suggested: ReturnType<typeof step> = step(
      built,
      `playbook:${ENRICH_PLAYBOOK_ID}`,
    );

    expect(suggested.phase).toBe(types.ResponsePhase.Confirm);
    expect(suggested.text).toEqual({
      template: copy.STEP_AI_PLAYBOOK,
      values: { playbook: "Enrich New Cases" },
    });
    expect(suggested.action?.playbookId).toBe(ENRICH_PLAYBOOK_ID);

    expect(
      step(
        plan.buildResponsePlan(
          input({
            playbooks,
            ai: { suggestedPlaybookId: ENRICH_PLAYBOOK_ID },
            ranPlaybookIds: [ENRICH_PLAYBOOK_ID],
          }),
        ),
        `playbook:${ENRICH_PLAYBOOK_ID}`,
      ).isDone,
    ).toBe(true);
  });

  test("a playbook it suggests that the project no longer has, or switched off, takes no step", () => {
    expect(
      keys(
        plan.buildResponsePlan(
          input({ ai: { suggestedPlaybookId: ENRICH_PLAYBOOK_ID } }),
        ),
      ).some((key: string): boolean => {
        return key.startsWith("playbook:");
      }),
    ).toBe(false);
  });
});

describe("a step's key", () => {
  test("is what it is and what it is about, case folded", () => {
    expect(plan.getResponseStepKey("contain:block-ip", " 35.196.249.14 ")).toBe(
      "contain:block-ip:35.196.249.14",
    );
    expect(plan.getResponseStepKey("contain:user", "Ana@Acme.Example")).toBe(
      "contain:user:ana@acme.example",
    );
    expect(plan.getResponseStepKey("close")).toBe("close");
  });

  test("is hashed when it would run past what a task keeps, the same way every time", () => {
    const long: string = `${"a".repeat(120)}@acme.example`;
    const key: string = plan.getResponseStepKey("contain:user", long);

    expect(key.length).toBeLessThanOrEqual(plan.RESPONSE_STEP_KEY_MAX_LENGTH);
    expect(key).toBe(`contain:user:#${plan.hashText(long.toLowerCase())}`);
    expect(plan.getResponseStepKey("contain:user", long.toUpperCase())).toBe(
      key,
    );
    expect(plan.hashText("abc")).toMatch(/^[0-9a-f]{8}$/);
    expect(plan.hashText("abc")).not.toBe(plan.hashText("abd"));
  });
});

describe("what the plan reads", () => {
  test("the case's tasks a step was made from, with who ticked each off", () => {
    const done: SecurityCaseTask = new SecurityCaseTask();
    done._id = "t1";
    done.responseStepKey = "fix:public-app";
    done.isDone = true;
    done.doneAt = new Date("2026-11-17T20:00:00.000Z");
    const doer: User = new User();
    doer.name = "Kim Morgan" as never;
    done.doneByUser = doer;

    const byHand: SecurityCaseTask = new SecurityCaseTask();
    byHand._id = "t2";
    byHand.title = "Pull the proxy logs";

    expect(data.readResponseTasks([done, byHand])).toEqual([
      {
        id: "t1",
        responseStepKey: "fix:public-app",
        isDone: true,
        doneAt: new Date("2026-11-17T20:00:00.000Z"),
        doneByName: "Kim Morgan",
      },
    ]);
  });

  test("each playbook by what its steps do, a step it cannot read left out", () => {
    const playbook: SecurityPlaybook = new SecurityPlaybook();
    playbook._id = OKTA_PLAYBOOK_ID;
    playbook.name = "Suspend in Okta";
    playbook.steps = [
      { action: SecurityPlaybookActionType.SuspendOktaUser },
      { action: SecurityPlaybookActionType.SuspendOktaUser },
      { nothing: true },
      "x",
    ] as never;

    expect(data.readResponsePlaybooks([playbook])).toEqual([
      {
        id: OKTA_PLAYBOOK_ID,
        name: "Suspend in Okta",
        actions: [SecurityPlaybookActionType.SuspendOktaUser],
      },
    ]);
  });

  test("a ticked step's task is its words as the person read them, kept to a line", () => {
    expect(
      data.getResponseStepTitle({ step: {}, text: "  Block   it.  " }),
    ).toBe("Block it.");
    expect(
      data.getResponseStepTitle({ step: { aiText: "AI words" }, text: "x" }),
    ).toBe("AI words");
    expect(
      data.getResponseStepTitle({ step: {}, text: "y".repeat(600) }),
    ).toHaveLength(500);
  });

  test("OneUptime AI's read is drawn worried, calm or unsure", () => {
    expect(
      data.getCaseResponseVerdictTone(SecurityCaseAiVerdict.LikelyMalicious),
    ).toBe(PillTone.Danger);
    expect(
      data.getCaseResponseVerdictTone(
        SecurityCaseAiVerdict.LikelyFalsePositive,
      ),
    ).toBe(PillTone.Success);
    expect(
      data.getCaseResponseVerdictTone(SecurityCaseAiVerdict.Inconclusive),
    ).toBe(PillTone.Warning);
  });
});

describe("where its links go", () => {
  test("the traces of the requests, over the detection's window", () => {
    const route: Route | null = plan.getRequestTracesRoute({
      detection: detection({
        events: [event(), event({ traceId: "trace-2" })],
      }),
      onlyThrough: false,
    });
    const url: globalThis.URL = new globalThis.URL(
      route!.toString(),
      "https://oneuptime.example",
    );

    expect(url.pathname).toBe(`${BASE}/traces`);
    expect(route!.toString()).toContain("trace-1");
    expect(route!.toString()).toContain("trace-2");
  });
});
