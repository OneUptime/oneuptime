// The alert path pulls the isolated-vm addon through its template renderer: stub it out.
jest.mock("isolated-vm", () => {
  return {};
});

import DetectionRule from "../../../../Models/DatabaseModels/DetectionRule";
import SecurityAutomaticResponseAction from "../../../../Models/DatabaseModels/SecurityAutomaticResponseAction";
import SecurityAutomaticResponsePolicy from "../../../../Models/DatabaseModels/SecurityAutomaticResponsePolicy";
import SecurityBlock from "../../../../Models/DatabaseModels/SecurityBlock";
import SecurityBlockEnforcement from "../../../../Models/DatabaseModels/SecurityBlockEnforcement";
import SecurityDetection from "../../../../Models/DatabaseModels/SecurityDetection";
import SecurityPlaybookRun from "../../../../Models/DatabaseModels/SecurityPlaybookRun";
import Queue from "../../../../Server/Infrastructure/Queue";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Server/Infrastructure/Semaphore";
import DetectionRuleExceptionService from "../../../../Server/Services/DetectionRuleExceptionService";
import DetectionRuleService from "../../../../Server/Services/DetectionRuleService";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../../Server/Services/OpenTelemetryIngestService";
import SecurityAutomaticResponseActionService from "../../../../Server/Services/SecurityAutomaticResponseActionService";
import SecurityAutomaticResponsePolicyService from "../../../../Server/Services/SecurityAutomaticResponsePolicyService";
import SecurityBlockEnforcementService from "../../../../Server/Services/SecurityBlockEnforcementService";
import SecurityBlockService from "../../../../Server/Services/SecurityBlockService";
import SecurityCaseFeedService from "../../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import SecurityDetectionService from "../../../../Server/Services/SecurityDetectionService";
import SecurityEventService, {
  DetectionMatchGroup,
} from "../../../../Server/Services/SecurityEventService";
import SecurityPlaybookRunService, {
  OneStepRunRequest,
} from "../../../../Server/Services/SecurityPlaybookRunService";
import ThreatIntelIndicatorService from "../../../../Server/Services/ThreatIntelIndicatorService";
import logger from "../../../../Server/Utils/Logger";
import SecurityAutomaticResponse, {
  SECURITY_AUTOMATIC_RESPONSE_DECIDE_JOB,
  SecurityAutomaticResponseDecision,
  SecurityAutomaticResponseJobData,
  readSecurityAutomaticResponseJobData,
} from "../../../../Server/Utils/SecurityAutomaticResponse/SecurityAutomaticResponse";
import SecurityAutomaticResponseRecorder from "../../../../Server/Utils/SecurityAutomaticResponse/SecurityAutomaticResponseRecorder";
import SecurityRepeatOffenders from "../../../../Server/Utils/SecurityAutomaticResponse/SecurityRepeatOffenders";
import SecuritySignedInAddresses, {
  SecuritySignedInAddressState,
} from "../../../../Server/Utils/SecurityAutomaticResponse/SecuritySignedInAddresses";
import SecurityBlockDestination, {
  SecurityBlockCapacity,
  SecurityBlockEntry,
  SecurityBlockSupport,
} from "../../../../Server/Utils/SecurityBlocklist/SecurityBlockDestination";
import SecurityBlockDestinations from "../../../../Server/Utils/SecurityBlocklist/SecurityBlockDestinations";
import {
  SecurityBlocklistDestinationPlan,
  planSecurityBlocklistDestination,
} from "../../../../Server/Utils/SecurityBlocklist/SecurityBlocklistReconciler";
import SecurityCaseIngest, {
  SecurityDetectionSignal,
  toRecordedDetection,
} from "../../../../Server/Utils/SecurityCase/SecurityCaseIngest";
import SecurityEntityRiskRecorder from "../../../../Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskRecorder";
import RealTimeDetectionJob, {
  readRealTimeJobData,
} from "../../../../Server/Utils/SecurityEvent/RealTime/RealTimeDetectionJob";
import RealTimeDetections, {
  REAL_TIME_DETECTION_JOB,
} from "../../../../Server/Utils/SecurityEvent/RealTime/RealTimeDetections";
import { RealTimeJobData } from "../../../../Server/Utils/SecurityEvent/RealTime/RealTimeJobs";
import { buildSecurityEventDbRow } from "../../../../Server/Utils/SecurityEvent/SecurityEventRow";
import SecurityEventRetention from "../../../../Server/Utils/SecurityEvent/SecurityEventRetention";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityAutomaticResponseMode,
  SecurityAutomaticResponsePolicyKind,
} from "../../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import { SecurityAutomaticResponseOutcome } from "../../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponseOutcome";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
  SecurityBlockIndicatorType,
  SecurityBlockSource,
  SecurityBlockState,
  readSecurityBlockValue,
} from "../../../../Types/SecurityBlocklist/SecurityBlock";
import {
  SecurityBlockDestinationProvider,
  SecurityBlockEnforcementState,
} from "../../../../Types/SecurityBlocklist/SecurityBlockEnforcement";
import {
  DETECTION_RULE_LIBRARY,
  DetectionRuleLibraryEntry,
} from "../../../../Types/SecurityEvent/DetectionRuleLibrary";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity from "../../../../Types/SecurityEvent/OcsfSeverity";
import SecurityEventRequestOutcome from "../../../../Types/SecurityEvent/SecurityEventRequestOutcome";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import { buildDetectionRuleFromLibrary } from "../../../../Utils/SecurityEvent/SecurityTemplateRecords";
import { mockProjectStates } from "../../TestingUtils/Services/ProjectStatesHelper";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import timers from "timers";

/*
 * A SCANNER, FROM ITS REQUESTS TO THE CASE'S LINE (#10350): the issue's
 * promise end to end, through the modules that keep it, with only the
 * databases answered by hand.
 *
 *   1. a scanner sends requests that climb out of the web root, each
 *      turned away with a 403;
 *   2. the write screens them against the project's real-time rule
 *      (Path traversal attempts, from the Rule Library) and queues the
 *      rule's job;
 *   3. the job confirms them with the rule's own query, and the detection
 *      is recorded on a case;
 *   4. the Scanners policy, on, screens the detection and queues its
 *      decision;
 *   5. the decision passes every guardrail and challenges the address
 *      through the playbook engine, for 1 hour, with nobody's approval;
 *   6. the reconciler hands the challenge to a test destination that can
 *      challenge, which holds it;
 *   7. the recorder sees it take hold, and the case says what happened -
 *      and the time from the first request to the challenge holding is
 *      well inside the two minutes the issue promises, by the delays the
 *      pipeline itself runs on.
 */

/*
 * The screen gives the event loop a turn every few hundred rows
 * (setImmediate), and Common's jest environment is jsdom, which has none:
 * lend it Node's.
 */
if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "81111111-1111-4111-8111-111111111111",
);
const RULE_ID: ObjectID = new ObjectID("82222222-2222-4222-8222-222222222222");
const POLICY_ID: ObjectID = new ObjectID(
  "83333333-3333-4333-8333-333333333333",
);
const CASE_ID: ObjectID = new ObjectID("84444444-4444-4444-8444-444444444444");
const DETECTION_ID: ObjectID = new ObjectID(
  "85555555-5555-4555-8555-555555555555",
);
const ADMIN_ID: ObjectID = new ObjectID("86666666-6666-4666-8666-666666666666");
const RUN_ID: ObjectID = new ObjectID("87777777-7777-4777-8777-777777777777");
const BLOCK_ID: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888888");
const ADDRESS: string = "35.205.11.131";
const PATH_TRAVERSAL_RULE: string = "68d61e5d-79d2-4f41-8c1b-c017f6d0bd52";
const TWO_MINUTES_IN_MS: number = 2 * 60 * 1000;

// The scanner's first request, and then one every 2 seconds.
const FIRST_REQUEST: Date = new Date(
  Math.floor(Date.now() / 60000) * 60000 - 10 * 60 * 1000,
);
const PROBES: Array<string> = [
  "/../../etc/passwd",
  "/static/..%2f..%2fetc/passwd",
  "/download?file=../../../etc/shadow",
  "/%2e%2e%2f%2e%2e%2fwp-config.php",
  "/images/../../.env",
  "/assets/..%2F..%2F.git/config",
];

const SERVICE: TelemetryServiceMetadata = {
  serviceName: "Edge access logs",
  primaryEntityId: new ObjectID("89999999-9999-4999-8999-999999999999"),
  primaryEntityType: ServiceType.OpenTelemetry,
  dataRententionInDays: 15,
  serviceRetentionConfig: null,
  serviceRetentionInDays: null,
  projectRetentionConfig: null,
  projectRetentionInDays: 15,
};

// One of the scanner's requests, as a security event, turned away with a 403.
function scannerRequest(index: number): JSONObject {
  const normalized: NormalizedSecurityEvent = {
    time: new Date(FIRST_REQUEST.getTime() + index * 2000),
    eventUid: `probe-${index}`,
    categoryUid: 4,
    categoryName: "Network Activity",
    classUid: 4002,
    className: "HTTP Activity",
    activityName: "Get",
    severityId: 1,
    severityName: OcsfSeverity.Informational,
    statusName: "Failure",
    message: `GET ${PROBES[index]} 403`,
    vendorName: "nginx",
    productName: "nginx",
    ruleId: "",
    ruleName: "",
    mitreTactics: [],
    mitreTechniques: [],
    principalUser: "",
    principalHost: "",
    principalIp: ADDRESS,
    principalProcess: "",
    processName: "",
    processPath: "",
    processCommandLine: "",
    parentProcessName: "",
    parentProcessPath: "",
    parentProcessCommandLine: "",
    targetUser: "",
    targetHost: "shop.example.com",
    targetIp: "",
    targetPort: 443,
    targetResource: PROBES[index]!,
    observables: [ADDRESS],
    attributes: {},
    requestOutcome: SecurityEventRequestOutcome.Rejected,
  };

  return buildSecurityEventDbRow({
    normalized,
    projectId: PROJECT_ID,
    serviceMetadata: SERVICE,
    retentionDays: 15,
  });
}

// The Rule Library's rule, as the Scanners policy adds it: on, opening cases, in real time.
function pathTraversalRule(): DetectionRule {
  const entry: DetectionRuleLibraryEntry = DETECTION_RULE_LIBRARY.find(
    (candidate: DetectionRuleLibraryEntry): boolean => {
      return candidate.id === PATH_TRAVERSAL_RULE;
    },
  )!;
  const rule: DetectionRule = buildDetectionRuleFromLibrary({
    projectId: PROJECT_ID,
    entry,
  });
  rule._id = RULE_ID.toString();
  rule.isEnabled = true;
  rule.isRealTime = true;
  return rule;
}

// A destination that can challenge, holding what it is handed, at the time it is handed it.
class TestEdge implements SecurityBlockDestination {
  public readonly key: string = "TestEdge:zone-1";
  public readonly provider: SecurityBlockDestinationProvider =
    SecurityBlockDestinationProvider.Cloudflare;
  public readonly name: string = "Test Edge";
  public readonly connectionId: ObjectID | null = null;
  public readonly canChallenge: boolean = true;
  public held: Array<SecurityBlockEntry> = [];

  public supports(): SecurityBlockSupport {
    return { isSupported: true };
  }

  public async capacity(): Promise<SecurityBlockCapacity> {
    return { limit: null };
  }

  public async apply(
    entries: Array<SecurityBlockEntry>,
  ): Promise<Array<never>> {
    this.held.push(...entries);
    return [];
  }

  public async remove(): Promise<Array<never>> {
    return [];
  }

  public async readBack(): Promise<Array<never>> {
    return [];
  }
}

type QueuedJob = { name: string; data: JSONObject; delayInMs: number };

let now: Date;
let queued: Array<QueuedJob>;
let signals: Array<SecurityDetectionSignal>;
let actions: Array<SecurityAutomaticResponseAction>;
let startedRuns: Array<OneStepRunRequest>;
let timeline: Array<string>;
let caseWrites: Array<JSONObject>;
let enforcement: SecurityBlockEnforcement | null;

function policy(): SecurityAutomaticResponsePolicy {
  const made: SecurityAutomaticResponsePolicy =
    new SecurityAutomaticResponsePolicy(POLICY_ID);
  made.projectId = PROJECT_ID;
  made.kind = SecurityAutomaticResponsePolicyKind.Scanners;
  made.name = "Scanners";
  made.mode = SecurityAutomaticResponseMode.On;
  made.turnedOnAt = new Date(FIRST_REQUEST.getTime() - 24 * 60 * 60 * 1000);
  made.turnedOnByUserId = ADMIN_ID;
  return made;
}

beforeEach(() => {
  now = new Date(FIRST_REQUEST.getTime() + PROBES.length * 2000);
  queued = [];
  signals = [];
  actions = [];
  startedRuns = [];
  timeline = [];
  caseWrites = [];
  enforcement = null;
  RealTimeDetections.clearCache();
  SecurityAutomaticResponse.clearCache();

  jest.spyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
  jest.spyOn(logger, "warn").mockImplementation((() => {
    return undefined;
  }) as never);
  mockProjectStates();
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(now);
  });

  // Every job any step queues, with when it runs.
  jest.spyOn(Queue, "addJob").mockImplementation((async (
    _queue: unknown,
    _id: unknown,
    name: string,
    data: JSONObject,
    options?: { delayInMs?: number },
  ) => {
    queued.push({ name, data, delayInMs: options?.delayInMs || 0 });
  }) as never);

  // The project's rules: the one real-time rule, on.
  jest
    .spyOn(DetectionRuleService, "findBy")
    .mockResolvedValue([pathTraversalRule()] as never);
  jest
    .spyOn(DetectionRuleService, "findOneBy")
    .mockResolvedValue(pathTraversalRule() as never);
  jest
    .spyOn(DetectionRuleService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(DetectionRuleExceptionService, "findAllBy")
    .mockResolvedValue([] as never);
  jest
    .spyOn(SecurityEventRetention, "getRetentionInDays")
    .mockResolvedValue(15 as never);
  jest
    .spyOn(OTelIngestService, "telemetryServiceFromName")
    .mockResolvedValue(SERVICE as never);
  jest
    .spyOn(SecurityEventService, "insertJsonRows")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(SecurityEntityRiskRecorder, "record")
    .mockResolvedValue({ entitiesUpdated: 1, riskCasesRaised: 0 } as never);

  // ClickHouse, as it answers the job: every request readable, and the rule's query matching the address.
  jest.spyOn(SecurityEventService, "executeQuery").mockResolvedValue({
    json: async () => {
      return { data: [{ readable: PROBES.length }] };
    },
  } as never);
  jest
    .spyOn(SecurityEventService, "findDetectionArrivalWindows")
    .mockImplementation((async () => {
      return [
        {
          windowStart: new Date(
            Math.floor(FIRST_REQUEST.getTime() / (5 * 60 * 1000)) *
              (5 * 60 * 1000),
          ),
          firstArrivedAt: FIRST_REQUEST,
        },
      ];
    }) as never);
  jest.spyOn(SecurityEventService, "findDetectionMatches").mockResolvedValue([
    {
      groupValue: ADDRESS,
      matchCount: PROBES.length,
      distinctCount: 0,
      sampleMessage: `GET ${PROBES[0]} 403`,
      sampleObservables: [ADDRESS],
    },
  ] as Array<DetectionMatchGroup> as never);

  // The case: the detection is recorded on it, as the ingest records it.
  jest.spyOn(SecurityCaseIngest, "recordDetections").mockImplementation((async (
    recorded: Array<SecurityDetectionSignal>,
  ) => {
    signals.push(...recorded);
    return { casesOpened: 1, detectionsAdded: 1, detectionsRepeated: 0 };
  }) as never);

  // The policy's reads and writes.
  jest
    .spyOn(SecurityAutomaticResponsePolicyService, "findActivePolicies")
    .mockResolvedValue([policy()] as never);
  jest
    .spyOn(SecurityAutomaticResponsePolicyService, "findOneBy")
    .mockResolvedValue(policy() as never);
  jest.spyOn(Semaphore, "lock").mockResolvedValue({} as SemaphoreMutex);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined);
  jest
    .spyOn(SecurityDetectionService, "findOneBy")
    .mockImplementation((async () => {
      const signal: SecurityDetectionSignal = signals[0]!;
      const detection: SecurityDetection = new SecurityDetection(DETECTION_ID);
      detection.projectId = PROJECT_ID;
      detection.securityCaseId = CASE_ID;
      detection.title = signal.title;
      detection.source = signal.source;
      detection.detectionRuleId = signal.detectionRuleId;
      detection.mitreTechniques = signal.mitreTechniques;
      detection.groupValue = signal.groupValue;
      detection.firstSeenAt = now;
      // What the case keeps of the requests: each one's time and address, and how far each got.
      detection.matchedEvents = {
        events: PROBES.map((_probe: string, index: number): JSONObject => {
          return {
            time: new Date(
              FIRST_REQUEST.getTime() + index * 2000,
            ).toISOString(),
            principalIp: ADDRESS,
          };
        }),
        outcomes: { [SecurityEventRequestOutcome.Rejected]: PROBES.length },
      } as unknown as JSONObject;
      return detection;
    }) as never);
  jest
    .spyOn(ThreatIntelIndicatorService, "findActiveIndicatorsByValues")
    .mockResolvedValue([] as never);
  jest
    .spyOn(SecurityAutomaticResponseActionService, "findOneBy")
    .mockResolvedValue(null as never);
  jest
    .spyOn(SecurityAutomaticResponseActionService, "countBy")
    .mockResolvedValue({
      toNumber: () => {
        return 0;
      },
    } as never);
  jest
    .spyOn(SecurityAutomaticResponseActionService, "create")
    .mockImplementation((async (data: {
      data: SecurityAutomaticResponseAction;
    }) => {
      const action: SecurityAutomaticResponseAction = data.data;
      action.id = new ObjectID("8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      action.createdAt = new Date(now);
      actions.push(action);
      return action;
    }) as never);
  jest
    .spyOn(SecurityAutomaticResponseActionService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest.spyOn(SecurityBlockService, "check").mockResolvedValue({
    value: readSecurityBlockValue(ADDRESS)!,
    problem: null,
    coveredBy: null,
    protection: { protection: null, unreadSources: [] },
  } as never);
  jest.spyOn(SecuritySignedInAddresses, "check").mockResolvedValue({
    state: SecuritySignedInAddressState.None,
    value: ADDRESS,
    since: new Date(),
  } as never);
  jest.spyOn(SecurityRepeatOffenders, "read").mockResolvedValue({
    value: ADDRESS,
    since: new Date(),
    blocks: [],
    offenceCount: 0,
    last: null,
  } as never);
  jest
    .spyOn(SecurityPlaybookRunService, "startOneStepRun")
    .mockImplementation((async (request: OneStepRunRequest) => {
      startedRuns.push(request);
      return new SecurityPlaybookRun(RUN_ID);
    }) as never);

  // The case's timeline and its own columns.
  jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockImplementation((async (data: { feedInfoInMarkdown: string }) => {
      timeline.push(data.feedInfoInMarkdown);
    }) as never);
  jest
    .spyOn(SecurityCaseService, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation((async (data: { data: JSONObject }) => {
      caseWrites.push(data.data);
      return true;
    }) as never);
  jest
    .spyOn(
      SecurityAutomaticResponseActionService,
      "compareAndSetColumnsByIdWithoutHooks",
    )
    .mockResolvedValue(true as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The jobs one step queued of a kind, and moves the clock to when the first of them runs.
function runNext(name: string): QueuedJob {
  const job: QueuedJob | undefined = queued.find((candidate: QueuedJob) => {
    return candidate.name === name;
  });

  expect(job).toBeDefined();
  queued = queued.filter((candidate: QueuedJob): boolean => {
    return candidate !== job;
  });
  now = new Date(now.getTime() + job!.delayInMs);
  return job!;
}

describe("a scanner, from its requests to the case's line", () => {
  test("its requests fire the real-time rule, the Scanners policy challenges it at the edge, and the case says so, well inside two minutes", async () => {
    // 1-2. The write: the scanner's requests, screened against the real-time rule.
    const rows: Array<JSONObject> = PROBES.map(
      (_probe: string, index: number): JSONObject => {
        return scannerRequest(index);
      },
    );
    const jobs: number = await RealTimeDetections.screen({
      projectId: PROJECT_ID,
      rows,
    });

    expect(jobs).toBe(1);

    // 3. The rule's job: its own query confirms the requests, and the detection is recorded.
    const ruleJob: RealTimeJobData = readRealTimeJobData(
      runNext(REAL_TIME_DETECTION_JOB).data,
    )!;

    expect(ruleJob.ruleId).toBe(RULE_ID.toString());
    expect(ruleJob.events).toHaveLength(PROBES.length);

    await RealTimeDetectionJob.evaluate(ruleJob);

    expect(signals).toHaveLength(1);
    expect(signals[0]!.groupValue).toBe(ADDRESS);
    expect(signals[0]!.mitreTechniques).toContain("T1190");

    // 4. The policy screens the detection as it is recorded, and queues its decision.
    const screened: number = await SecurityAutomaticResponse.screen({
      projectId: PROJECT_ID,
      detections: [
        toRecordedDetection({
          signal: signals[0]!,
          securityCaseId: CASE_ID,
          securityDetectionId: DETECTION_ID,
        }),
      ],
    });

    expect(screened).toBe(1);

    const decisionJob: SecurityAutomaticResponseJobData =
      readSecurityAutomaticResponseJobData(
        runNext(SECURITY_AUTOMATIC_RESPONSE_DECIDE_JOB).data,
      )!;

    expect(decisionJob.address).toBe(ADDRESS);

    // 5. The decision: every guardrail passed, a challenge through the playbook engine.
    const decision: SecurityAutomaticResponseDecision | null =
      await SecurityAutomaticResponse.decide(decisionJob);

    expect(decision).toMatchObject({
      outcome: SecurityAutomaticResponseOutcome.Challenged,
      address: ADDRESS,
      isTrialRun: false,
      duration: SecurityBlockDuration.OneHour,
    });
    expect(startedRuns).toHaveLength(1);
    expect(startedRuns[0]!.automaticResponsePolicyId?.toString()).toBe(
      POLICY_ID.toString(),
    );

    // 6. The engine's block, handed by the reconciler to an edge that can challenge.
    const block: SecurityBlock = new SecurityBlock(BLOCK_ID);
    block.projectId = PROJECT_ID;
    block.value = ADDRESS;
    block.indicatorType = SecurityBlockIndicatorType.IpAddress;
    block.action = SecurityBlockAction.Challenge;
    block.challengeFallsBackToBlock = true;
    block.state = SecurityBlockState.Active;
    block.source = SecurityBlockSource.AutomaticResponse;
    block.securityAutomaticResponsePolicyId = POLICY_ID;
    block.securityCaseId = CASE_ID;
    block.createdAt = new Date(now);
    block.expiresAt = new Date(now.getTime() + 60 * 60 * 1000);

    const edge: TestEdge = new TestEdge();
    const plan: SecurityBlocklistDestinationPlan =
      planSecurityBlocklistDestination({
        destination: edge,
        blocks: [block],
        rowsByBlock: new Map(),
        held: [],
        capacity: await edge.capacity(),
        now,
      });

    expect(
      plan.toAdd.map((entry: SecurityBlockEntry): [string, string] => {
        return [entry.value, entry.action];
      }),
    ).toEqual([[ADDRESS, SecurityBlockAction.Challenge]]);

    await edge.apply(plan.toAdd);
    const appliedAt: Date = new Date(now);

    enforcement = new SecurityBlockEnforcement();
    enforcement.projectId = PROJECT_ID;
    enforcement.securityBlockId = BLOCK_ID;
    enforcement.destinationKey = edge.key;
    enforcement.destinationName = edge.name;
    enforcement.state = SecurityBlockEnforcementState.Applied;
    enforcement.appliedAt = appliedAt;

    // 7. The recorder sees it take hold: the case says so, with how fast.
    const action: SecurityAutomaticResponseAction = actions[0]!;
    action.securityBlockId = BLOCK_ID;
    action.securityPlaybookRunId = RUN_ID;

    jest
      .spyOn(SecurityAutomaticResponseActionService, "findBy")
      .mockResolvedValue([action] as never);
    jest
      .spyOn(SecurityBlockEnforcementService, "findForBlocks")
      .mockImplementation((async () => {
        return [enforcement!];
      }) as never);
    jest
      .spyOn(SecurityBlockService, "findByIds")
      .mockResolvedValue([block] as never);
    jest.spyOn(SecurityBlockDestinations, "findForProject").mockResolvedValue({
      destinations: [edge],
      failedProviders: [],
    } as never);

    now = new Date(now.getTime() + 60 * 1000);
    const held: number =
      await SecurityAutomaticResponseRecorder.recordBlocksTakingHold(now);

    expect(held).toBe(1);

    const seconds: number = Math.round(
      (appliedAt.getTime() - FIRST_REQUEST.getTime()) / 1000,
    );

    expect(timeline).toContain(
      `🛡️ OneUptime challenged \`${ADDRESS}\` at Test Edge for 1 hour (Scanners policy), ${seconds} seconds after its first request.`,
    );
    expect(caseWrites).toContainEqual(
      expect.objectContaining({ timeToBlockInSeconds: seconds }),
    );
    // From the first request to the challenge holding: inside two minutes, by the pipeline's own delays.
    expect(appliedAt.getTime() - FIRST_REQUEST.getTime()).toBeLessThan(
      TWO_MINUTES_IN_MS,
    );
  });
});
