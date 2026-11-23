import SecurityAutomaticResponseAction from "../../../../Models/DatabaseModels/SecurityAutomaticResponseAction";
import SecurityAutomaticResponsePolicy from "../../../../Models/DatabaseModels/SecurityAutomaticResponsePolicy";
import SecurityBlock from "../../../../Models/DatabaseModels/SecurityBlock";
import SecurityDetection from "../../../../Models/DatabaseModels/SecurityDetection";
import SecurityPlaybookRun from "../../../../Models/DatabaseModels/SecurityPlaybookRun";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import SecurityAutomaticResponseActionService from "../../../../Server/Services/SecurityAutomaticResponseActionService";
import SecurityAutomaticResponsePolicyService from "../../../../Server/Services/SecurityAutomaticResponsePolicyService";
import SecurityBlockService from "../../../../Server/Services/SecurityBlockService";
import SecurityCaseFeedService from "../../../../Server/Services/SecurityCaseFeedService";
import SecurityDetectionService from "../../../../Server/Services/SecurityDetectionService";
import SecurityPlaybookRunService, {
  OneStepRunRequest,
} from "../../../../Server/Services/SecurityPlaybookRunService";
import ThreatIntelIndicatorService from "../../../../Server/Services/ThreatIntelIndicatorService";
import SecurityAutomaticResponse, {
  SecurityAutomaticResponseDecision,
  SecurityAutomaticResponseJobData,
  buildAutomaticResponseStep,
  getFirstRequestAt,
  readSecurityAutomaticResponseJobData,
} from "../../../../Server/Utils/SecurityAutomaticResponse/SecurityAutomaticResponse";
import SecurityAutomaticResponseOwners from "../../../../Server/Utils/SecurityAutomaticResponse/SecurityAutomaticResponseOwners";
import SecurityRepeatOffenders from "../../../../Server/Utils/SecurityAutomaticResponse/SecurityRepeatOffenders";
import SecuritySignedInAddresses, {
  SecuritySignedInAddressCheck,
  SecuritySignedInAddressState,
  SecuritySignedInSource,
} from "../../../../Server/Utils/SecurityAutomaticResponse/SecuritySignedInAddresses";
import { SecurityProtectionCheck } from "../../../../Server/Utils/SecurityBlocklist/SecurityProtectedAddresses";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityAutomaticResponseMode,
  SecurityAutomaticResponsePolicyKind,
} from "../../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import { SecurityAutomaticResponseOutcome } from "../../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponseOutcome";
import { SecurityRepeatOffenderRecord } from "../../../../Types/SecurityAutomaticResponse/SecurityRepeatOffenders";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
  SecurityBlockIndicatorType,
  SecurityBlockValue,
  readSecurityBlockValue,
} from "../../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityProtectedAddressSource } from "../../../../Types/SecurityBlocklist/SecurityProtectedAddress";
import SecurityDetectionSource from "../../../../Types/SecurityCase/SecurityDetectionSource";
import SecurityEventRequestOutcome from "../../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import { SecurityPlaybookActionType } from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import {
  SecurityPlaybookStep,
  doesStepNeedApproval,
  parseSecurityPlaybookSteps,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import SecurityPlaybookTrigger from "../../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../../Server/Utils/Logger");

/*
 * AN AUTOMATIC RESPONSE DECISION (#10350): every guardrail in order, then
 * what the policy does. The services it reads and writes are faked as they
 * answer; pinned here:
 *
 *   - never a protected or own address, nor one OneUptime cannot check;
 *   - never an address a signed-in user used, nor one OneUptime cannot
 *     tell about;
 *   - longer blocks for repeat offenders;
 *   - at most 50 automatic blocks an hour, then a page, once an hour;
 *   - a trial run records what it would have done and blocks nothing;
 *   - a policy that is on blocks through the playbook engine: a one-step
 *     run of the policy's, its step needing nobody's approval.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const POLICY_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CASE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const DETECTION_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const ADMIN_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const RUN_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const ADDRESS: string = "35.205.11.131";
const FIRST_REQUEST: Date = new Date("2026-11-22T09:59:00.000Z");
const TURNED_ON_AT: Date = new Date("2026-11-15T09:00:00.000Z");

const JOB: SecurityAutomaticResponseJobData = {
  projectId: PROJECT_ID.toString(),
  securityAutomaticResponsePolicyId: POLICY_ID.toString(),
  securityCaseId: CASE_ID.toString(),
  securityDetectionId: DETECTION_ID.toString(),
  address: ADDRESS,
};

let policy: SecurityAutomaticResponsePolicy | null;
let detection: SecurityDetection | null;
let latestDecision: SecurityAutomaticResponseAction | null;
let liveBlocksThisHour: number;
let trialBlocksThisHour: number;
let pagedThisHour: number;
let created: Array<SecurityAutomaticResponseAction>;
let updated: Array<{ id: ObjectID; data: JSONObject }>;
let timeline: Array<string>;
let check: Awaited<ReturnType<(typeof SecurityBlockService)["check"]>>;
let signedIn: SecuritySignedInAddressCheck;
let offences: number | Error;
let listed: boolean;
let paged: Array<{ title: string; descriptionInMarkdown: string }>;
let startedRuns: Array<OneStepRunRequest>;
let runFailure: Error | null;
// The case's unfinished runs with no playbook: a person's or OneUptime AI's one-step runs.
let oneStepRunsOnTheCase: Array<SecurityPlaybookRun>;

function readValue(value: string): SecurityBlockValue {
  return readSecurityBlockValue(value)!;
}

function makePolicy(data: {
  kind?: SecurityAutomaticResponsePolicyKind;
  mode: SecurityAutomaticResponseMode;
}): SecurityAutomaticResponsePolicy {
  const made: SecurityAutomaticResponsePolicy =
    new SecurityAutomaticResponsePolicy(POLICY_ID);
  made.projectId = PROJECT_ID;
  made.kind = data.kind || SecurityAutomaticResponsePolicyKind.Scanners;
  made.name =
    made.kind === SecurityAutomaticResponsePolicyKind.Scanners
      ? "Scanners"
      : made.kind === SecurityAutomaticResponsePolicyKind.PasswordGuessing
        ? "Password Guessing"
        : "Known-Bad Addresses";
  made.mode = data.mode;
  made.turnedOnAt = TURNED_ON_AT;
  made.turnedOnByUserId = ADMIN_ID;
  return made;
}

function makeDetection(data: {
  mitreTechniques?: Array<string>;
  outcomes?: Record<string, number>;
  source?: SecurityDetectionSource;
}): SecurityDetection {
  const made: SecurityDetection = new SecurityDetection(DETECTION_ID);
  made.projectId = PROJECT_ID;
  made.securityCaseId = CASE_ID;
  made.title = `Path traversal attempts — ${ADDRESS}`;
  made.source = data.source || SecurityDetectionSource.DetectionRule;
  made.mitreTechniques = data.mitreTechniques || ["T1190"];
  made.groupValue = ADDRESS;
  made.firstSeenAt = new Date("2026-11-22T10:00:00.000Z");
  made.matchedEvents = {
    events: [
      { time: "2026-11-22T09:59:30.000Z", principalIp: ADDRESS },
      { time: FIRST_REQUEST.toISOString(), principalIp: ADDRESS },
    ],
    outcomes: data.outcomes || { [SecurityEventRequestOutcome.Rejected]: 14 },
  } as unknown as JSONObject;
  return made;
}

function protection(
  data: Partial<SecurityProtectionCheck> = {},
): SecurityProtectionCheck {
  return {
    protection: null,
    unreadSources: [],
    ...data,
  } as SecurityProtectionCheck;
}

beforeEach(() => {
  policy = makePolicy({ mode: SecurityAutomaticResponseMode.On });
  detection = makeDetection({});
  latestDecision = null;
  liveBlocksThisHour = 0;
  trialBlocksThisHour = 0;
  pagedThisHour = 0;
  created = [];
  updated = [];
  timeline = [];
  check = {
    value: readValue(ADDRESS),
    problem: null,
    coveredBy: null,
    protection: protection(),
  };
  signedIn = {
    state: SecuritySignedInAddressState.None,
    value: ADDRESS,
    since: new Date(),
  };
  offences = 0;
  listed = false;
  paged = [];
  startedRuns = [];
  runFailure = null;
  oneStepRunsOnTheCase = [];

  jest.spyOn(Semaphore, "lock").mockResolvedValue({} as SemaphoreMutex);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
  jest
    .spyOn(SecurityAutomaticResponsePolicyService, "findOneBy")
    .mockImplementation(async () => {
      return policy;
    });
  jest
    .spyOn(SecurityDetectionService, "findOneBy")
    .mockImplementation(async () => {
      return detection;
    });
  jest
    .spyOn(ThreatIntelIndicatorService, "findActiveIndicatorsByValues")
    .mockImplementation(async () => {
      return listed ? ([{ indicatorValue: ADDRESS }] as never) : [];
    });
  jest
    .spyOn(SecurityAutomaticResponseActionService, "findOneBy")
    .mockImplementation(async () => {
      return latestDecision;
    });
  jest
    .spyOn(SecurityAutomaticResponseActionService, "countBy")
    .mockImplementation((async (data: { query: JSONObject }) => {
      const query: JSONObject = data.query;
      const count: number =
        query["pagedAt"] !== undefined
          ? pagedThisHour
          : query["isTrialRun"] === true
            ? trialBlocksThisHour
            : liveBlocksThisHour;

      return {
        toNumber: () => {
          return count;
        },
      } as never;
    }) as never);
  jest
    .spyOn(SecurityAutomaticResponseActionService, "create")
    .mockImplementation(
      async (data: { data: SecurityAutomaticResponseAction }) => {
        const action: SecurityAutomaticResponseAction = data.data;
        action.id = new ObjectID(
          `77777777-7777-4777-8777-${String(created.length + 1).padStart(12, "0")}`,
        );
        created.push(action);
        return action;
      },
    );
  jest
    .spyOn(SecurityAutomaticResponseActionService, "updateOneById")
    .mockImplementation((async (data: { id: ObjectID; data: JSONObject }) => {
      updated.push({ id: data.id, data: data.data });
    }) as never);
  jest.spyOn(SecurityBlockService, "check").mockImplementation(async () => {
    return check;
  });
  jest
    .spyOn(SecuritySignedInAddresses, "check")
    .mockImplementation(async () => {
      return signedIn;
    });
  jest.spyOn(SecurityRepeatOffenders, "read").mockImplementation(async () => {
    if (offences instanceof Error) {
      throw offences;
    }

    return {
      value: ADDRESS,
      since: new Date(),
      blocks: [],
      offenceCount: offences,
      last: null,
    } as SecurityRepeatOffenderRecord;
  });
  jest
    .spyOn(SecurityAutomaticResponseOwners, "page")
    .mockImplementation(
      async (data: { title: string; descriptionInMarkdown: string }) => {
        paged.push(data);
        return true;
      },
    );
  jest
    .spyOn(SecurityPlaybookRunService, "findBy")
    .mockImplementation((async (data: {
      query: { securityCaseId: ObjectID };
    }) => {
      expect(data.query.securityCaseId.toString()).toBe(CASE_ID.toString());
      return oneStepRunsOnTheCase;
    }) as never);
  jest
    .spyOn(SecurityPlaybookRunService, "startOneStepRun")
    .mockImplementation(async (request: OneStepRunRequest) => {
      startedRuns.push(request);

      if (runFailure) {
        throw runFailure;
      }

      return new SecurityPlaybookRun(RUN_ID);
    });
  jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockImplementation(async (data: { feedInfoInMarkdown: string }) => {
      timeline.push(data.feedInfoInMarkdown);
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function decide(): Promise<SecurityAutomaticResponseDecision | null> {
  return await SecurityAutomaticResponse.decide(JOB);
}

describe("a policy that is on", () => {
  test("challenges a scanner through the playbook engine: a one-step run of the policy's", async () => {
    const decision: SecurityAutomaticResponseDecision | null = await decide();

    expect(decision).toMatchObject({
      outcome: SecurityAutomaticResponseOutcome.Challenged,
      address: ADDRESS,
      isTrialRun: false,
      duration: SecurityBlockDuration.OneHour,
      securityPlaybookRunId: RUN_ID,
    });

    expect(startedRuns).toHaveLength(1);
    const run: OneStepRunRequest = startedRuns[0]!;
    expect(run.automaticResponsePolicyId).toEqual(POLICY_ID);
    expect(run.policyName).toBe("Scanners");
    expect(run.userId).toBeUndefined();
    expect(run.securityCaseId).toEqual(CASE_ID);
    expect(run.step.action).toBe(SecurityPlaybookActionType.BlockAddress);
    expect(run.step.config).toEqual({
      blockAction: SecurityBlockAction.Challenge,
      duration: SecurityBlockDuration.OneHour,
    });
    expect(run.targets).toEqual([
      expect.objectContaining({
        value: ADDRESS,
        state: SecurityPlaybookTargetState.Proposed,
      }),
    ]);

    // Recorded first, then pointed at its run.
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      outcome: SecurityAutomaticResponseOutcome.Challenged,
      isTrialRun: false,
      value: ADDRESS,
      blockAction: SecurityBlockAction.Challenge,
      duration: SecurityBlockDuration.OneHour,
      priorBlockCount: 0,
      policyName: "Scanners",
    });
    expect(created[0]!.firstRequestAt).toEqual(FIRST_REQUEST);
    expect(updated).toEqual([
      { id: created[0]!.id!, data: { securityPlaybookRunId: RUN_ID } },
    ]);
  });

  test("its step needs nobody's approval: the project turned the policy on, and the step says who and when", async () => {
    await decide();

    const step: SecurityPlaybookStep = startedRuns[0]!.step;

    expect(step.requiresApproval).toBe(false);
    expect(step.approvalTurnedOff).toEqual({
      byUserId: ADMIN_ID.toString(),
      at: TURNED_ON_AT.toISOString(),
    });

    // As the run reads its step back.
    const [parsed] = parseSecurityPlaybookSteps([step]);
    expect(doesStepNeedApproval(parsed!)).toBe(false);
  });

  test("password guessing is blocked, not challenged", async () => {
    policy = makePolicy({
      kind: SecurityAutomaticResponsePolicyKind.PasswordGuessing,
      mode: SecurityAutomaticResponseMode.On,
    });
    detection = makeDetection({
      mitreTechniques: ["T1110.001"],
      outcomes: { [SecurityEventRequestOutcome.ReachedApp]: 40 },
    });

    expect((await decide())?.outcome).toBe(
      SecurityAutomaticResponseOutcome.Blocked,
    );
    expect(startedRuns[0]!.step.config).toEqual({
      blockAction: SecurityBlockAction.Block,
      duration: SecurityBlockDuration.OneHour,
    });
  });

  test("a block that cannot be started is failed, with why, on the record and the case", async () => {
    runFailure = new Error(
      "Block the address is already waiting or running for 35.205.11.131 on this case.",
    );

    const decision: SecurityAutomaticResponseDecision | null = await decide();

    expect(decision?.outcome).toBe(SecurityAutomaticResponseOutcome.Failed);
    expect(updated[0]!.data).toEqual({
      outcome: SecurityAutomaticResponseOutcome.Failed,
      detail: runFailure.message,
    });
    expect(timeline[0]).toContain("already waiting or running");
  });
});

describe("the trial run", () => {
  beforeEach(() => {
    policy = makePolicy({ mode: SecurityAutomaticResponseMode.TrialRun });
  });

  test("records what it would have done, says so on the case, and blocks nothing", async () => {
    const decision: SecurityAutomaticResponseDecision | null = await decide();

    expect(decision).toMatchObject({
      outcome: SecurityAutomaticResponseOutcome.Challenged,
      isTrialRun: true,
      securityPlaybookRunId: null,
    });
    expect(startedRuns).toHaveLength(0);
    expect(created[0]).toMatchObject({
      isTrialRun: true,
      outcome: SecurityAutomaticResponseOutcome.Challenged,
    });
    expect(timeline[0]).toBe(
      "🧪 Trial run: the Scanners policy would have challenged `35.205.11.131` for 1 hour. It only records what it would do until it is turned on, so nothing was blocked.",
    );
  });

  test("is held to the hour's limit as if it were on, counting what it would have made", async () => {
    liveBlocksThisHour = 30;
    trialBlocksThisHour = 20;

    const decision: SecurityAutomaticResponseDecision | null = await decide();

    expect(decision?.outcome).toBe(
      SecurityAutomaticResponseOutcome.StoppedAtLimit,
    );
    expect(decision?.isTrialRun).toBe(true);
    // Nobody is paged over a trial run.
    expect(paged).toHaveLength(0);
    expect(timeline[0]).toContain("would not have challenged");
  });
});

describe("never a protected or own address", () => {
  test("one of the project's own is left alone, its record never named", async () => {
    check = {
      ...check,
      protection: protection({
        protection: {
          source: SecurityProtectedAddressSource.Host,
          protectedValue: ADDRESS,
          name: "web-3",
        },
      }),
    };

    const decision: SecurityAutomaticResponseDecision | null = await decide();

    expect(decision?.outcome).toBe(
      SecurityAutomaticResponseOutcome.SparedProtected,
    );
    expect(decision?.detail).toBe(
      "35.205.11.131 is one of your project's own addresses.",
    );
    expect(decision?.detail).not.toContain("web-3");
    expect(startedRuns).toHaveLength(0);
    expect(timeline[0]).toBe(
      "🛡️ The Scanners policy left `35.205.11.131` alone. 35.205.11.131 is one of your project's own addresses.",
    );
  });

  test("one on the Protected Entities list is left alone", async () => {
    check = {
      ...check,
      protection: protection({
        protection: {
          source: SecurityProtectedAddressSource.ProtectedEntity,
          protectedValue: "35.205.11.0/24",
        },
      }),
    };

    expect((await decide())?.outcome).toBe(
      SecurityAutomaticResponseOutcome.SparedProtected,
    );
  });

  test("one OneUptime cannot check is left for a person", async () => {
    check = {
      ...check,
      protection: protection({
        unreadSources: [SecurityProtectedAddressSource.CloudResource],
      }),
    };

    const decision: SecurityAutomaticResponseDecision | null = await decide();

    expect(decision?.outcome).toBe(
      SecurityAutomaticResponseOutcome.SparedCannotTell,
    );
    expect(decision?.detail).toContain("could not check whether 35.205.11.131");
    expect(startedRuns).toHaveLength(0);
  });

  test("an address a block already covers is left as it is, recording nothing", async () => {
    const covering: SecurityBlock = new SecurityBlock();
    covering.value = "35.205.11.0/24";
    covering.indicatorType = SecurityBlockIndicatorType.IpRange;
    check = { ...check, coveredBy: covering };

    expect(await decide()).toBeNull();
    expect(created).toHaveLength(0);
    expect(startedRuns).toHaveLength(0);
  });

  /*
   * OneUptime AI working the case (#10352), or a person from it (#10342),
   * may be blocking the address already, in a one-step run of its own
   * waiting for approval or running. The policy leaves the address to that
   * run: one of its own would be refused beside it, and its block is
   * coming. A run of another address, or of another action, is no reason.
   */
  test("an address a one-step run on the case is blocking already is left to that run, recording nothing", async () => {
    const runOf: (data: {
      action: SecurityPlaybookActionType;
      value: string;
    }) => SecurityPlaybookRun = (data: {
      action: SecurityPlaybookActionType;
      value: string;
    }): SecurityPlaybookRun => {
      const run: SecurityPlaybookRun = new SecurityPlaybookRun(RUN_ID);
      run.trigger = SecurityPlaybookTrigger.OneUptimeAi;
      run.steps = [
        {
          id: "step-1",
          action: data.action,
          config: {},
          requiresApproval: true,
          continueOnFailure: false,
          onlyIfThreatIntelMatched: false,
        },
      ] as unknown as JSONArray;
      run.stepResults = [
        {
          stepId: "step-1",
          status: "Pending",
          targets: [
            {
              type: SecurityEntityType.IpAddress,
              value: data.value,
              reason: SecurityPlaybookTargetReason.GroupedOn,
              state: SecurityPlaybookTargetState.Proposed,
            },
          ],
        },
      ] as unknown as JSONArray;
      return run;
    };

    // Another address, and another action on this one: no reason to wait.
    oneStepRunsOnTheCase = [
      runOf({
        action: SecurityPlaybookActionType.BlockAddress,
        value: "203.0.113.9",
      }),
      runOf({
        action: SecurityPlaybookActionType.SuspendOktaUser,
        value: ADDRESS,
      }),
    ];
    expect((await decide())?.outcome).toBe(
      SecurityAutomaticResponseOutcome.Challenged,
    );

    created = [];
    startedRuns = [];
    oneStepRunsOnTheCase = [
      runOf({
        action: SecurityPlaybookActionType.BlockAddress,
        value: ADDRESS,
      }),
    ];

    expect(await decide()).toBeNull();
    expect(created).toHaveLength(0);
    expect(startedRuns).toHaveLength(0);
  });
});

describe("never an address a signed-in user used", () => {
  test("one a signed-in user used in the last 30 days is left alone, naming who", async () => {
    signedIn = {
      state: SecuritySignedInAddressState.SignedIn,
      value: ADDRESS,
      since: new Date(),
      users: [
        {
          name: "jane@example.com",
          source: SecuritySignedInSource.Requests,
          lastSeenAt: new Date(),
        },
        {
          name: "bob@example.com",
          source: SecuritySignedInSource.IdentityProvider,
          lastSeenAt: new Date(),
        },
      ],
    };

    const decision: SecurityAutomaticResponseDecision | null = await decide();

    expect(decision?.outcome).toBe(
      SecurityAutomaticResponseOutcome.SparedSignedIn,
    );
    expect(decision?.detail).toBe(
      "A signed-in user used 35.205.11.131 in the last 30 days: jane@example.com on your app's requests, and bob@example.com signing in through your identity provider. An address someone signed in uses, such as an office's or a customer's, is never blocked automatically.",
    );
    expect(startedRuns).toHaveLength(0);
  });

  test("one OneUptime cannot tell about - a hidden address, a read that failed - is left for a person, saying why", async () => {
    signedIn = {
      state: SecuritySignedInAddressState.CannotTell,
      value: ADDRESS,
      since: new Date(),
      reason:
        "Your scrub rule Hide IPs hides client addresses in your logs, so OneUptime cannot tell whether a signed-in user used 35.205.11.131. It is left for a person: hash addresses instead to let OneUptime check.",
    };

    const decision: SecurityAutomaticResponseDecision | null = await decide();

    expect(decision?.outcome).toBe(
      SecurityAutomaticResponseOutcome.SparedCannotTell,
    );
    expect(decision?.detail).toBe(signedIn.reason);
    expect(startedRuns).toHaveLength(0);
  });
});

describe("repeat offenders get longer blocks", () => {
  test("24 hours for an address blocked once before in 30 days", async () => {
    offences = 1;

    expect((await decide())?.duration).toBe(SecurityBlockDuration.OneDay);
    expect(startedRuns[0]!.step.config["duration"]).toBe(
      SecurityBlockDuration.OneDay,
    );
    expect(created[0]!.priorBlockCount).toBe(1);
  });

  test("7 days for one blocked twice before", async () => {
    offences = 2;

    expect((await decide())?.duration).toBe(SecurityBlockDuration.SevenDays);
  });

  test("the first length when the blocklist cannot say how often", async () => {
    offences = new Error("database unavailable");

    expect((await decide())?.duration).toBe(SecurityBlockDuration.OneHour);
  });
});

describe("at most 50 automatic blocks an hour", () => {
  test("the 51st stops, and pages the project's security owners", async () => {
    liveBlocksThisHour = 50;

    const decision: SecurityAutomaticResponseDecision | null = await decide();

    expect(decision?.outcome).toBe(
      SecurityAutomaticResponseOutcome.StoppedAtLimit,
    );
    expect(startedRuns).toHaveLength(0);
    expect(paged).toHaveLength(1);
    expect(paged[0]!.title).toBe(
      "Automatic response stopped: 50 blocks in the last hour",
    );
    expect(created[0]!.pagedAt).toBeInstanceOf(Date);
    expect(timeline[0]).toBe(
      "⚠️ The Scanners policy did not challenge `35.205.11.131`: your automatic response policies made 50 blocks in the last hour, the most they make in an hour, so they stopped. Your security owners were paged: an attack this large needs a person.",
    );
  });

  test("pages once an hour: the next stop says they were paged", async () => {
    liveBlocksThisHour = 64;
    pagedThisHour = 1;

    await decide();

    expect(paged).toHaveLength(0);
    expect(created[0]!.pagedAt).toBeUndefined();
    expect(timeline[0]).toContain("Your security owners were paged");
  });

  test("49 blocks leave room for one more", async () => {
    liveBlocksThisHour = 49;

    expect((await decide())?.outcome).toBe(
      SecurityAutomaticResponseOutcome.Challenged,
    );
  });
});

describe("what is decided once", () => {
  test("a policy turned off since is not decided for", async () => {
    policy = makePolicy({ mode: SecurityAutomaticResponseMode.Off });

    expect(await decide()).toBeNull();
    expect(created).toHaveLength(0);
  });

  test("an address the policy blocked within its block's length is left as it is", async () => {
    latestDecision = new SecurityAutomaticResponseAction();
    latestDecision.outcome = SecurityAutomaticResponseOutcome.Challenged;
    latestDecision.duration = SecurityBlockDuration.OneHour;
    latestDecision.createdAt = new Date(Date.now() - 20 * 60 * 1000);

    expect(await decide()).toBeNull();
  });

  test("an address spared within the hour is left as it is, and decided again after", async () => {
    latestDecision = new SecurityAutomaticResponseAction();
    latestDecision.outcome = SecurityAutomaticResponseOutcome.SparedSignedIn;
    latestDecision.createdAt = new Date(Date.now() - 30 * 60 * 1000);

    expect(await decide()).toBeNull();

    latestDecision.createdAt = new Date(Date.now() - 61 * 60 * 1000);

    expect((await decide())?.outcome).toBe(
      SecurityAutomaticResponseOutcome.Challenged,
    );
  });

  test("an address OneUptime could not tell about is tried again after ten minutes", async () => {
    latestDecision = new SecurityAutomaticResponseAction();
    latestDecision.outcome = SecurityAutomaticResponseOutcome.SparedCannotTell;
    latestDecision.createdAt = new Date(Date.now() - 11 * 60 * 1000);

    expect((await decide())?.outcome).toBe(
      SecurityAutomaticResponseOutcome.Challenged,
    );
  });

  test("a scanner one of whose requests got through is left to a person", async () => {
    detection = makeDetection({
      outcomes: {
        [SecurityEventRequestOutcome.Rejected]: 20,
        [SecurityEventRequestOutcome.ReachedDatabase]: 1,
      },
    });

    expect(await decide()).toBeNull();
    expect(created).toHaveLength(0);
  });
});

describe("Known-Bad Addresses", () => {
  beforeEach(() => {
    policy = makePolicy({
      kind: SecurityAutomaticResponsePolicyKind.KnownBadAddresses,
      mode: SecurityAutomaticResponseMode.On,
    });
    detection = makeDetection({ mitreTechniques: ["T1046"] });
  });

  test("blocks for 24 hours an address the project's feeds list", async () => {
    listed = true;

    expect(await decide()).toMatchObject({
      outcome: SecurityAutomaticResponseOutcome.Blocked,
      duration: SecurityBlockDuration.OneDay,
    });
  });

  test("leaves an address no feed lists", async () => {
    listed = false;

    expect(await decide()).toBeNull();
  });

  test("a threat intel detection is about a listed address without a read", async () => {
    detection = makeDetection({ source: SecurityDetectionSource.ThreatIntel });

    expect((await decide())?.outcome).toBe(
      SecurityAutomaticResponseOutcome.Blocked,
    );
  });
});

describe("the job's data", () => {
  test("is read defensively", () => {
    expect(readSecurityAutomaticResponseJobData(JOB)).toEqual(JOB);
    expect(
      readSecurityAutomaticResponseJobData({ ...JOB, address: "2001:DB8::7" })
        ?.address,
    ).toBe("2001:db8::7");
    expect(
      readSecurityAutomaticResponseJobData({ ...JOB, address: "x" }),
    ).toBeNull();
    expect(
      readSecurityAutomaticResponseJobData({ ...JOB, projectId: "nope" }),
    ).toBeNull();
    expect(readSecurityAutomaticResponseJobData(null)).toBeNull();
    expect(readSecurityAutomaticResponseJobData([JOB])).toBeNull();
  });
});

describe("the step", () => {
  test("without anyone named, a policy's step still needs no approval", () => {
    const step: SecurityPlaybookStep = buildAutomaticResponseStep({
      blockAction: SecurityBlockAction.Block,
      duration: SecurityBlockDuration.OneDay,
      turnedOnByUserId: null,
      turnedOnAt: null,
      now: TURNED_ON_AT,
    });

    expect(step.approvalTurnedOff).toEqual({ at: TURNED_ON_AT.toISOString() });
    expect(doesStepNeedApproval(parseSecurityPlaybookSteps([step])[0]!)).toBe(
      false,
    );
  });
});

describe("the first request", () => {
  test("is the earliest event the detection kept, else when it was first seen", () => {
    expect(
      getFirstRequestAt({
        matched: {
          events: [
            { time: "2026-11-22T09:59:30.000Z" },
            { time: "2026-11-22T09:58:00.000Z" },
          ],
          outcomes: {},
        } as never,
      }),
    ).toEqual(new Date("2026-11-22T09:58:00.000Z"));
    expect(
      getFirstRequestAt({
        matched: null,
        firstSeenAt: "2026-11-22T10:00:00.000Z",
      }),
    ).toEqual(new Date("2026-11-22T10:00:00.000Z"));
    expect(getFirstRequestAt({ matched: null })).toBeNull();
  });
});
