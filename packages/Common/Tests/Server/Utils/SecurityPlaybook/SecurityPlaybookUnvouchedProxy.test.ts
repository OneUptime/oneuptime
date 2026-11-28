import Queue from "../../../../Server/Infrastructure/Queue";
import SecurityCaseFeedService from "../../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import SecurityPlaybookRunService from "../../../../Server/Services/SecurityPlaybookRunService";
import SecurityCaseMatches from "../../../../Server/Utils/SecurityCase/Context/SecurityCaseMatches";
import SecurityTrustedProxies from "../../../../Server/Utils/SecurityEvent/SecurityTrustedProxies";
import SecurityPlaybookActions, {
  PlaybookStepContext,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookActions";
import SecurityPlaybookEngine from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookEngine";
import SecurityPlaybookTargets from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookTargets";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityPlaybookRun from "../../../../Models/DatabaseModels/SecurityPlaybookRun";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
} from "../../../../Types/SecurityBlocklist/SecurityBlock";
import { SecurityCaseMatchesJson } from "../../../../Types/SecurityCase/SecurityCaseMatches";
import SecurityCasePriorityLevel from "../../../../Types/SecurityCase/SecurityCasePriorityLevel";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import { SECURITY_REQUEST_ATTRIBUTES } from "../../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import { SecurityPlaybookActionType } from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookRunStatus, {
  SecurityPlaybookStepStatus,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { SecurityPlaybookStep } from "../../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookApprovalDecision,
  SecurityPlaybookStepResult,
  SecurityPlaybookTarget,
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
  buildPendingStepResults,
  readStepResults,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import SecurityPlaybookTrigger from "../../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import NetworkAddressBlockUtil from "../../../../Utils/NetworkTraffic/NetworkAddressBlock";
import { getCaseUnvouchedAddresses } from "../../../../Utils/SecurityCase/CaseClaimedClientAddress";
import {
  ClientAddressTrust,
  TrustedProxies,
  UnvouchedForwarding,
} from "../../../../Utils/SecurityEvent/ClientAddressTrust";
import { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import { testPriorityId } from "../../../Helpers/SecurityCaseValues";
import { getJestSpyOn } from "../../../Spy";
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
 * #11389: A PLAYBOOK NEVER BLOCKS, WITH NOBODY'S APPROVAL, AN ADDRESS A PROXY
 * NOTHING VOUCHES FOR FORWARDED.
 *
 * A proxy trusted only because it is private may be a TCP proxy that passed
 * on the X-Forwarded-For the client wrote, so the address the walk took from
 * it may be the client's own words. A Block Address step that needs no
 * approval - a playbook's, OneUptime AI's, an automatic response policy's -
 * waits for a person instead when the case's requests named one of its
 * addresses so, and each such target says through which proxy. The person
 * who picks an address on a case's Response Plan, and starts the block
 * themselves, decides for themselves. Read with the case's requests and the
 * project's trusted proxies as they are now.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CASE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const RUN_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const PLAYBOOK_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const PERSON_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);

const FORWARDED: string = "203.0.113.70";
const VERIFIED: string = "198.51.100.20";
const PRIVATE_PROXY: string = "10.0.1.57";

// The case's requests: one address forwarded through a private proxy, one its connection's own.
function caseMatches(
  forwardedBy: string = PRIVATE_PROXY,
): SecurityCaseMatchesJson {
  return {
    detections: [
      {
        id: "66666666-6666-4666-8666-666666666666",
        title: `Path traversal attempts - ${FORWARDED}`,
        groupValue: FORWARDED,
        events: [
          {
            id: "event-1",
            time: "2026-11-28T10:30:00.000Z",
            message: "GET /../../etc/passwd",
            principalIp: FORWARDED,
            traceId: "",
            spanId: "",
            attributes: {
              [SECURITY_REQUEST_ATTRIBUTES.clientAddressTrust]:
                ClientAddressTrust.TrustedProxy,
              [SECURITY_REQUEST_ATTRIBUTES.forwardedBy]: forwardedBy,
            },
          },
          {
            id: "event-2",
            time: "2026-11-28T10:31:00.000Z",
            message: "GET /.env",
            principalIp: VERIFIED,
            traceId: "",
            spanId: "",
            attributes: {
              [SECURITY_REQUEST_ATTRIBUTES.clientAddressTrust]:
                ClientAddressTrust.Peer,
            },
          },
        ],
      },
    ],
    detectionCount: 1,
    unreadableSources: [],
    failedSources: [],
  } as unknown as SecurityCaseMatchesJson;
}

function proxiesListing(...ranges: Array<string>): TrustedProxies {
  return {
    blocks: ranges.map((range: string) => {
      return NetworkAddressBlockUtil.parse(range)!;
    }),
    trustsPrivateAddresses: true,
  };
}

function ipTarget(
  value: string,
  state: SecurityPlaybookTargetState = SecurityPlaybookTargetState.Proposed,
): SecurityPlaybookTarget {
  return {
    type: SecurityEntityType.IpAddress,
    value,
    reason: SecurityPlaybookTargetReason.GroupedOn,
    state,
  };
}

let matches: SecurityCaseMatchesJson | Error;
let proxies: TrustedProxies;

function useCaseReads(): void {
  getJestSpyOn(SecurityCaseMatches, "build").mockImplementation((async (data: {
    props: unknown;
    securityCaseId: ObjectID;
  }) => {
    // Read as OneUptime: what protects an address is what the case's requests say, whoever runs the step.
    expect(data.props).toEqual({ isRoot: true });
    expect(data.securityCaseId.toString()).toBe(CASE_ID.toString());

    if (matches instanceof Error) {
      throw matches;
    }

    return matches;
  }) as never);
  getJestSpyOn(SecurityTrustedProxies, "getForProject").mockImplementation(
    (async () => {
      return proxies;
    }) as never,
  );
}

describe("marking the addresses a block would act on", () => {
  beforeEach(() => {
    matches = caseMatches();
    proxies = proxiesListing();
    useCaseReads();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function mark(
    targets: Array<SecurityPlaybookTarget>,
  ): Promise<Array<SecurityPlaybookTarget>> {
    return await SecurityPlaybookTargets.markUnvouchedAddresses({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
      targets,
    });
  }

  test("an address an unlisted private proxy forwarded is marked with the proxy; its connection's own is left as it is", async () => {
    expect(await mark([ipTarget(FORWARDED), ipTarget(VERIFIED)])).toEqual([
      { ...ipTarget(FORWARDED), unvouchedProxy: PRIVATE_PROXY },
      ipTarget(VERIFIED),
    ]);
  });

  test("once the proxy is listed, nothing is marked", async () => {
    proxies = proxiesListing("10.0.1.0/24");

    expect(await mark([ipTarget(FORWARDED)])).toEqual([ipTarget(FORWARDED)]);
  });

  test("a mark from before the proxy was listed is taken off, and the target is otherwise as it was", async () => {
    proxies = proxiesListing("10.0.1.0/24");

    const marked: Array<SecurityPlaybookTarget> = await mark([
      { ...ipTarget(FORWARDED), unvouchedProxy: PRIVATE_PROXY },
    ]);

    expect(marked).toEqual([ipTarget(FORWARDED)]);
    expect(Object.keys(marked[0]!)).not.toContain("unvouchedProxy");
  });

  test("an address written another way is the same address", async () => {
    matches = caseMatches();
    (
      matches.detections[0]!.events[0] as unknown as { principalIp: string }
    ).principalIp = "2001:db8::70";

    expect(await mark([ipTarget("2001:DB8:0:0:0:0:0:70")])).toEqual([
      { ...ipTarget("2001:DB8:0:0:0:0:0:70"), unvouchedProxy: PRIVATE_PROXY },
    ]);
  });

  test("a case whose requests cannot be read marks every address it would block: a person decides", async () => {
    matches = new Error("ClickHouse is not answering.");

    expect(await mark([ipTarget(FORWARDED), ipTarget(VERIFIED)])).toEqual([
      { ...ipTarget(FORWARDED), unvouchedProxy: "" },
      { ...ipTarget(VERIFIED), unvouchedProxy: "" },
    ]);
  });

  test("only proposed addresses: a protected one, one left out, a user, are never marked - and with none, nothing is read", async () => {
    const others: Array<SecurityPlaybookTarget> = [
      ipTarget(FORWARDED, SecurityPlaybookTargetState.Protected),
      ipTarget(FORWARDED, SecurityPlaybookTargetState.LeftOut),
      {
        type: SecurityEntityType.User,
        value: "mallory@acme.com",
        reason: SecurityPlaybookTargetReason.GroupedOn,
        state: SecurityPlaybookTargetState.Proposed,
      },
    ];

    expect(await mark(others)).toEqual(others);
    expect(SecurityCaseMatches.build).not.toHaveBeenCalled();
    expect(SecurityTrustedProxies.getForProject).not.toHaveBeenCalled();
  });

  test("the mark is kept on the step's results, and read back as written", () => {
    const step: SecurityPlaybookStep = blockStep();
    const results: Array<SecurityPlaybookStepResult> = readStepResults(
      [
        {
          stepId: step.id,
          status: SecurityPlaybookStepStatus.WaitingForApproval,
          targets: [
            { ...ipTarget(FORWARDED), unvouchedProxy: ` ${PRIVATE_PROXY} ` },
            { ...ipTarget(VERIFIED), unvouchedProxy: "" },
            { ...ipTarget("192.0.2.9"), unvouchedProxy: 7 },
          ],
        },
      ] as unknown as JSONArray,
      [step],
    );

    expect(results[0]!.targets).toEqual([
      { ...ipTarget(FORWARDED), unvouchedProxy: PRIVATE_PROXY },
      { ...ipTarget(VERIFIED), unvouchedProxy: "" },
      ipTarget("192.0.2.9"),
    ]);
  });
});

describe("the addresses a case's requests named through a proxy nothing vouches for", () => {
  test("each once, canonical, with the first such proxy", () => {
    const found: Map<string, UnvouchedForwarding> = getCaseUnvouchedAddresses({
      matches: caseMatches(),
      proxies: proxiesListing(),
    });

    expect(Array.from(found.entries())).toEqual([
      [FORWARDED, { hop: PRIVATE_PROXY }],
    ]);
  });

  test("none for a case that cannot be read, or whose proxies are all vouched for", () => {
    expect(
      getCaseUnvouchedAddresses({ matches: null, proxies: proxiesListing() })
        .size,
    ).toBe(0);
    expect(
      getCaseUnvouchedAddresses({
        matches: caseMatches(),
        proxies: proxiesListing("10.0.0.0/8"),
      }).size,
    ).toBe(0);
  });

  test("a hop where a load balancer that passes on connects from is never vouched for, listed or not", () => {
    expect(
      getCaseUnvouchedAddresses({
        matches: caseMatches(),
        proxies: {
          ...proxiesListing("10.0.0.0/8"),
          untrustedBlocks: [NetworkAddressBlockUtil.parse("10.0.1.0/24")!],
        },
      }).get(FORWARDED),
    ).toEqual({ hop: PRIVATE_PROXY });
  });
});

// The engine, with the run, its case and its steps' effects stubbed, and the marking real.
function blockStep(
  extra: Partial<SecurityPlaybookStep> = {},
): SecurityPlaybookStep {
  return {
    id: "block-step",
    action: SecurityPlaybookActionType.BlockAddress,
    config: {
      blockAction: SecurityBlockAction.Block,
      duration: SecurityBlockDuration.OneDay,
    },
    requiresApproval: false,
    approvalTurnedOff: {
      byUserId: "44444444-4444-4444-8444-444444444444",
      at: "2026-11-20T10:00:00.000Z",
    },
    continueOnFailure: false,
    onlyIfThreatIntelMatched: false,
    ...extra,
  } as SecurityPlaybookStep;
}

interface RunState {
  status: SecurityPlaybookRunStatus;
  steps: Array<SecurityPlaybookStep>;
  stepResults: Array<SecurityPlaybookStepResult>;
  currentStepIndex: number;
  threatIntelMatched: boolean;
}

let state: RunState;
// Who the run is: a playbook's, a person's one-step run, OneUptime AI's, a policy's.
let runIs: Partial<{
  securityPlaybookId: ObjectID;
  triggeredByUserId: ObjectID;
  trigger: SecurityPlaybookTrigger;
  securityAutomaticResponsePolicyId: ObjectID;
}>;
let executed: Array<PlaybookStepContext>;

function useRun(results?: Array<SecurityPlaybookStepResult>): void {
  const steps: Array<SecurityPlaybookStep> = [blockStep()];

  state = {
    status: SecurityPlaybookRunStatus.Queued,
    steps,
    stepResults: results || buildPendingStepResults(steps),
    currentStepIndex: 0,
    threatIntelMatched: false,
  };
}

function runModel(): SecurityPlaybookRun {
  const run: SecurityPlaybookRun = new SecurityPlaybookRun();
  run._id = RUN_ID.toString();
  run.projectId = PROJECT_ID;
  run.securityCaseId = CASE_ID;
  run.playbookName = "Contain scanners";
  run.status = state.status;
  run.steps = state.steps as unknown as JSONArray;
  run.stepResults = state.stepResults as unknown as JSONArray;
  run.currentStepIndex = state.currentStepIndex;
  run.threatIntelMatched = state.threatIntelMatched;
  Object.assign(run, runIs);
  return run;
}

describe("a Block Address step that needs no approval", () => {
  beforeEach(() => {
    matches = caseMatches();
    proxies = proxiesListing();
    runIs = { securityPlaybookId: PLAYBOOK_ID };
    executed = [];
    useRun();
    useCaseReads();

    getJestSpyOn(SecurityPlaybookTargets, "selectTargets").mockResolvedValue([
      ipTarget(FORWARDED),
    ] as never);
    getJestSpyOn(
      SecurityPlaybookRunService,
      "compareAndSetColumnsByIdWithoutHooks",
    ).mockImplementation((async (input: unknown) => {
      const { data, expectedData } = input as {
        data: Partial<RunState>;
        expectedData: Partial<RunState>;
      };

      if (expectedData.status !== state.status) {
        return false;
      }

      Object.assign(state, data);
      return true;
    }) as never);
    getJestSpyOn(Queue, "addJob").mockResolvedValue(undefined as never);
    getJestSpyOn(SecurityPlaybookRunService, "findOneById").mockImplementation(
      (async () => {
        return runModel();
      }) as never,
    );
    getJestSpyOn(
      SecurityPlaybookRunService,
      "updateOneById",
    ).mockImplementation((async (input: unknown) => {
      const data: JSONObject = (input as { data: JSONObject }).data;

      if (data["stepResults"]) {
        state.stepResults = data[
          "stepResults"
        ] as unknown as Array<SecurityPlaybookStepResult>;
      }

      if (typeof data["currentStepIndex"] === "number") {
        state.currentStepIndex = data["currentStepIndex"] as number;
      }

      return 1;
    }) as never);
    getJestSpyOn(
      SecurityPlaybookRunService,
      "updateColumnsByIdWithoutHooks",
    ).mockImplementation((async (input: unknown) => {
      Object.assign(state, (input as { data: Partial<RunState> }).data);
    }) as never);
    getJestSpyOn(SecurityCaseService, "findOneBy").mockImplementation(
      (async () => {
        const securityCase: SecurityCase = new SecurityCase();
        securityCase._id = CASE_ID.toString();
        securityCase.projectId = PROJECT_ID;
        securityCase.securityCasePriorityId = testPriorityId(
          SecurityCasePriorityLevel.High,
        );
        return securityCase;
      }) as never,
    );
    getJestSpyOn(
      SecurityCaseFeedService,
      "createSecurityCaseFeedItem",
    ).mockResolvedValue(undefined as never);
    getJestSpyOn(SecurityPlaybookActions, "execute").mockImplementation((async (
      context: PlaybookStepContext,
    ) => {
      executed.push(context);
      return {
        status: SecurityPlaybookStepStatus.Succeeded,
        summary: mdText`Blocked.`,
      };
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function run(): Promise<void> {
    await SecurityPlaybookEngine.executeRun(RUN_ID);
  }

  test("a playbook's waits for a person when an address it would block came through a proxy nothing vouches for, and says which", async () => {
    await run();

    expect(executed).toEqual([]);
    expect(state.status).toBe(SecurityPlaybookRunStatus.WaitingForApproval);
    expect(state.stepResults[0]!.status).toBe(
      SecurityPlaybookStepStatus.WaitingForApproval,
    );
    expect(state.stepResults[0]!.targets).toEqual([
      { ...ipTarget(FORWARDED), unvouchedProxy: PRIVATE_PROXY },
    ]);
  });

  test("a playbook's blocks as it did when the proxy is listed", async () => {
    proxies = proxiesListing("10.0.1.0/24");

    await run();

    expect(executed).toHaveLength(1);
    expect(executed[0]!.targets).toEqual([ipTarget(FORWARDED)]);
    expect(state.status).toBe(SecurityPlaybookRunStatus.Succeeded);
  });

  test("a playbook's blocks an address its connection verified, needing no person", async () => {
    getJestSpyOn(SecurityPlaybookTargets, "selectTargets").mockResolvedValue([
      ipTarget(VERIFIED),
    ] as never);

    await run();

    expect(executed).toHaveLength(1);
    expect(state.status).toBe(SecurityPlaybookRunStatus.Succeeded);
  });

  test("OneUptime AI's waits for a person too", async () => {
    runIs = { trigger: SecurityPlaybookTrigger.OneUptimeAi };

    await run();

    expect(executed).toEqual([]);
    expect(state.status).toBe(SecurityPlaybookRunStatus.WaitingForApproval);
  });

  test("an automatic response policy's waits for a person too", async () => {
    runIs = {
      securityAutomaticResponsePolicyId: new ObjectID(
        "99999999-9999-4999-8999-999999999999",
      ),
      trigger: SecurityPlaybookTrigger.AutomaticResponse,
    };

    await run();

    expect(executed).toEqual([]);
    expect(state.status).toBe(SecurityPlaybookRunStatus.WaitingForApproval);
  });

  test("the person who picked the address and started the block themselves decides for themselves", async () => {
    runIs = {
      triggeredByUserId: PERSON_ID,
      trigger: SecurityPlaybookTrigger.Manual,
    };

    await run();

    expect(executed).toHaveLength(1);
    // Still said: the block's targets keep why OneUptime would have asked.
    expect(executed[0]!.targets).toEqual([
      { ...ipTarget(FORWARDED), unvouchedProxy: PRIVATE_PROXY },
    ]);
  });

  test("a case whose requests cannot be read waits for a person", async () => {
    matches = new Error("ClickHouse is not answering.");

    await run();

    expect(executed).toEqual([]);
    expect(state.stepResults[0]!.targets).toEqual([
      { ...ipTarget(FORWARDED), unvouchedProxy: "" },
    ]);
  });

  test("once a person approves it, it blocks, and is not asked about again", async () => {
    const results: Array<SecurityPlaybookStepResult> = buildPendingStepResults([
      blockStep(),
    ]);

    results[0] = {
      ...results[0]!,
      targets: [{ ...ipTarget(FORWARDED), unvouchedProxy: PRIVATE_PROXY }],
      approval: {
        decision: SecurityPlaybookApprovalDecision.Approved,
        decidedByUserId: PERSON_ID.toString(),
        decidedAt: "2026-11-28T10:40:00.000Z",
      },
    };
    useRun(results);

    await run();

    expect(executed).toHaveLength(1);
    expect(SecurityCaseMatches.build).not.toHaveBeenCalled();
    expect(state.status).toBe(SecurityPlaybookRunStatus.Succeeded);
  });

  test("a step that needs approval anyway waits as it always did, and its targets say why too", async () => {
    state.steps = [
      blockStep({ requiresApproval: true, approvalTurnedOff: undefined }),
    ];
    state.stepResults = buildPendingStepResults(state.steps);

    await run();

    expect(executed).toEqual([]);
    expect(state.status).toBe(SecurityPlaybookRunStatus.WaitingForApproval);
    expect(state.stepResults[0]!.targets).toEqual([
      { ...ipTarget(FORWARDED), unvouchedProxy: PRIVATE_PROXY },
    ]);
  });
});
