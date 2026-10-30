import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import Runbook from "../../../../Models/DatabaseModels/Runbook";
import RunbookExecution from "../../../../Models/DatabaseModels/RunbookExecution";
import RumSessionPin from "../../../../Models/DatabaseModels/RumSessionPin";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityDetection from "../../../../Models/DatabaseModels/SecurityDetection";
import { SecurityCaseFeedEventType } from "../../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityCaseNote from "../../../../Models/DatabaseModels/SecurityCaseNote";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "../../../../Models/DatabaseModels/StatusPageAnnouncement";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import AIService from "../../../../Server/Services/AIService";
import RumSessionPinService from "../../../../Server/Services/RumSessionPinService";
import RunbookService from "../../../../Server/Services/RunbookService";
import SecurityCaseEvidenceService from "../../../../Server/Services/SecurityCaseEvidenceService";
import SecurityCaseNoteService from "../../../../Server/Services/SecurityCaseNoteService";
import SecurityDetectionService from "../../../../Server/Services/SecurityDetectionService";
import SecurityProtectedEntityService from "../../../../Server/Services/SecurityProtectedEntityService";
import StatusPageAnnouncementService from "../../../../Server/Services/StatusPageAnnouncementService";
import StatusPageService from "../../../../Server/Services/StatusPageService";
import TelemetryExceptionService from "../../../../Server/Services/TelemetryExceptionService";
import RuleRecordScope from "../../../../Server/Utils/Rules/RuleRecordScope";
import RunbookStarter, {
  RunbookStartRefusal,
} from "../../../../Server/Utils/Runbook/RunbookStarter";
import SecurityCaseEvidence, {
  SecurityCaseEvidenceLinks,
  SecurityCaseRequestEvidence,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityCaseEvidence";
import SecurityPlaybookActions, {
  PlaybookStepContext,
  PlaybookStepOutcome,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookActions";
import {
  RunbookCaseInputs,
  buildEvidenceNoteMarkdown,
  buildRunbookInputs,
  describeMissingReadiness,
  describeRunbookRefusal,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookResponseSteps";
import SecurityPlaybookTargets from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookTargets";
import URL from "../../../../Types/API/URL";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import RunbookTriggerType from "../../../../Types/Runbook/RunbookTriggerType";
import {
  SecurityEntity,
  SecurityEntityType,
} from "../../../../Types/SecurityCase/SecurityEntity";
import { SecurityPlaybookActionType } from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStepStatus } from "../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  SecurityPlaybookTarget,
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import { ProtectedEntityRule } from "../../../../Types/SecurityPlaybook/SecurityProtectedEntity";
import { SecurityCaseTemplateValues } from "../../../../Utils/SecurityCase/SecurityCaseMarkdown";

/*
 * THE STEPS THAT RESPOND THROUGH THE REST OF ONEUPTIME, as a run executes
 * them (SecurityPlaybookActions.execute -> SecurityPlaybookResponseSteps):
 *
 *   - Run a runbook starts the runbook the step names, as a security
 *     playbook, with the case as its inputs - the address, user and host the
 *     case is about by the containment rule, never a protected one - and
 *     links the run on the case; a runbook that will not start fails the
 *     step, saying why.
 *   - Preserve the evidence pins the session replays of the case's requests
 *     and notes their traces, replays and exceptions, saying plainly what
 *     cannot be kept; with nothing to keep, it is skipped.
 *   - Post a status page announcement posts what the step says, as it says
 *     it, on the project's pages it still has; subscribers only when asked.
 *   - Fix the code with AI asks for a fix of each open exception the case's
 *     requests threw, and is skipped - saying what is missing - when OneUptime
 *     AI cannot take one.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a5a",
);
const CASE_ID: ObjectID = new ObjectID("6b6b6b6b-6b6b-46b6-86b6-6b6b6b6b6b6b");
const RUN_ID: ObjectID = new ObjectID("7c7c7c7c-7c7c-47c7-87c7-7c7c7c7c7c7c");
const RUNBOOK_ID: string = "8d8d8d8d-8d8d-48d8-88d8-8d8d8d8d8d8d";
const EXECUTION_ID: string = "9e9e9e9e-9e9e-49e9-89e9-9e9e9e9e9e9e";
const PAGE_ID: string = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const OTHER_PAGE_ID: string = "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2";
const ANNOUNCEMENT_ID: string = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const RUM_APP_ID: string = "d4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4";
const EXCEPTION_ID: string = "e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5";
const SECOND_EXCEPTION_ID: string = "f6f6f6f6-f6f6-4f6f-8f6f-f6f6f6f6f6f6";
const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";

const LINKS: SecurityCaseEvidenceLinks = new SecurityCaseEvidenceLinks(
  URL.fromString("https://oneuptime.example/dashboard"),
  PROJECT_ID,
);

const VALUES: SecurityCaseTemplateValues = {
  number: "SEC-12",
  title: "SQL injection from 203.0.113.9",
  priority: "High",
  status: "New",
  assignee: "Unassigned",
  url: "https://oneuptime.example/dashboard/p/security-events/cases/12",
  entities: "203.0.113.9, alice, web-1",
  detections: "3",
};

const ENTITIES: Array<SecurityEntity> = [
  { type: SecurityEntityType.IpAddress, value: "203.0.113.9" },
  { type: SecurityEntityType.IpAddress, value: "10.0.0.5" },
  { type: SecurityEntityType.User, value: "alice" },
  { type: SecurityEntityType.User, value: "break-glass-admin" },
  { type: SecurityEntityType.Host, value: "web-1" },
  { type: SecurityEntityType.Host, value: "dc-01.corp.example.com" },
  { type: SecurityEntityType.Url, value: "/login?id=1' or 1=1" },
];

const PROTECTED: Array<ProtectedEntityRule> = [
  { type: SecurityEntityType.User, value: "break-glass-*" },
  { type: SecurityEntityType.Host, value: "*.corp.example.com" },
];

function target(
  type: SecurityEntityType,
  value: string,
  state: SecurityPlaybookTargetState = SecurityPlaybookTargetState.Proposed,
): SecurityPlaybookTarget {
  return {
    type,
    value,
    reason: SecurityPlaybookTargetReason.GroupedOn,
    state,
  };
}

function securityCase(): SecurityCase {
  const model: SecurityCase = new SecurityCase();
  model._id = CASE_ID.toString();
  model.projectId = PROJECT_ID;
  model.caseNumberWithPrefix = "SEC-12";
  model.title = "SQL injection from 203.0.113.9";
  model.entities = ENTITIES as unknown as JSONArray;
  return model;
}

function context(
  action: SecurityPlaybookActionType,
  config: JSONObject,
): PlaybookStepContext {
  return {
    projectId: PROJECT_ID,
    runId: RUN_ID,
    playbookName: "Contain web attacks",
    stepNumber: 2,
    securityCase: securityCase(),
    step: {
      id: "s2",
      action,
      config,
      requiresApproval: true,
      continueOnFailure: false,
      onlyIfThreatIntelMatched: false,
    },
  };
}

function request(
  overrides: Partial<SecurityCaseRequestEvidence>,
): SecurityCaseRequestEvidence {
  return {
    traceId: "",
    spanId: "",
    sessionId: "",
    exceptionFingerprint: "",
    requestOutcome: "",
    message: "",
    lastSeen: null,
    ...overrides,
  };
}

function exceptionGroup(
  id: string,
  overrides: Partial<TelemetryException> = {},
): TelemetryException {
  const model: TelemetryException = new TelemetryException();
  model._id = id;
  model.fingerprint = `fp-${id.slice(0, 4)}`;
  model.exceptionType = "SequelizeDatabaseError";
  model.message = 'syntax error at or near "or"';
  model.isResolved = false;
  model.isArchived = false;
  Object.assign(model, overrides);
  return model;
}

beforeEach(() => {
  jest
    .spyOn(SecurityCaseEvidence, "getLinks")
    .mockResolvedValue(LINKS as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a runbook's inputs: the case, and what it is about", () => {
  const targets: Array<SecurityPlaybookTarget> = [
    target(SecurityEntityType.IpAddress, "203.0.113.9"),
    target(SecurityEntityType.User, "alice"),
    target(
      SecurityEntityType.Host,
      "dc-01.corp.example.com",
      SecurityPlaybookTargetState.Protected,
    ),
  ];

  function inputs(
    overrides: Partial<Parameters<typeof buildRunbookInputs>[0]> = {},
  ): RunbookCaseInputs {
    return buildRunbookInputs({
      securityCaseId: CASE_ID.toString(),
      values: VALUES,
      playbookName: "Contain web attacks",
      entities: ENTITIES,
      targets,
      protectedRules: PROTECTED,
      ...overrides,
    });
  }

  test("say which case, from which playbook", () => {
    expect(inputs().inputs).toMatchObject({
      case_id: CASE_ID.toString(),
      case_number: "SEC-12",
      case_title: "SQL injection from 203.0.113.9",
      case_priority: "High",
      case_status: "New",
      case_url: VALUES.url,
      playbook: "Contain web attacks",
    });
  });

  test("ip, user and host are what the case is about, by the containment rule - never the victim, never a protected one", () => {
    const { inputs: values }: RunbookCaseInputs = inputs();

    expect(values["ip"]).toBe("203.0.113.9");
    expect(values["user"]).toBe("alice");
    // The only host target is protected, so there is no host to act on.
    expect(values["host"]).toBe("");
  });

  test("a case about no address hands an empty ip rather than any address it names", () => {
    expect(inputs({ targets: [] }).inputs["ip"]).toBe("");
    expect(inputs({ targets: [] }).inputs["ips"]).toEqual([
      "203.0.113.9",
      "10.0.0.5",
    ]);
  });

  test("the lists name every value of a kind the case names, but no protected user or host", () => {
    const { inputs: values, withheld }: RunbookCaseInputs = inputs();

    expect(values["users"]).toEqual(["alice"]);
    expect(values["hosts"]).toEqual(["web-1"]);
    expect(values["urls"]).toEqual(["/login?id=1' or 1=1"]);
    expect(values["domains"]).toEqual([]);
    expect(values["file_hashes"]).toEqual([]);
    expect(values["processes"]).toEqual([]);
    expect(
      withheld.map((entity: SecurityEntity): string => {
        return entity.value;
      }),
    ).toEqual(["break-glass-admin", "dc-01.corp.example.com"]);
  });

  test("a Data Security case hands over the store it is about, and every store it names", () => {
    const store: string =
      "data-store:cloud:aws:AWS S3 Bucket:arn:aws:s3:::orders-exports";
    const other: string = "data-store:database:5f0c2a4e";
    const { inputs: values, withheld }: RunbookCaseInputs = inputs({
      entities: [
        ...ENTITIES,
        { type: SecurityEntityType.DataStore, value: store },
        { type: SecurityEntityType.DataStore, value: other },
      ],
      targets: [...targets, target(SecurityEntityType.DataStore, store)],
    });

    expect(values["data_store"]).toBe(store);
    expect(values["data_stores"]).toEqual([store, other]);
    // A data store is never protected: nothing contains one.
    expect(
      withheld.some((entity: SecurityEntity): boolean => {
        return entity.type === SecurityEntityType.DataStore;
      }),
    ).toBe(false);
    // A case about no store hands an empty one.
    expect(inputs().inputs["data_store"]).toBe("");
    expect(inputs().inputs["data_stores"]).toEqual([]);
  });

  test("a target the protected list matches is never handed over, even if the target rule missed it", () => {
    const { inputs: values }: RunbookCaseInputs = inputs({
      targets: [target(SecurityEntityType.User, "break-glass-admin")],
    });

    expect(values["user"]).toBe("");
  });

  test("text is held to a length and never carries a NUL, which no environment variable can", () => {
    const { inputs: values }: RunbookCaseInputs = inputs({
      values: {
        ...VALUES,
        title: `a${String.fromCharCode(0)}b${"x".repeat(3000)}`,
      },
    });
    const title: string = values["case_title"] as string;

    expect(title.includes(String.fromCharCode(0))).toBe(false);
    expect(title.startsWith("ab")).toBe(true);
    expect(title.length).toBe(2000);
  });

  test("at most 50 values of a kind", () => {
    const many: Array<SecurityEntity> = [];

    for (let index: number = 0; index < 80; index++) {
      many.push({
        type: SecurityEntityType.IpAddress,
        value: `198.51.100.${index}`,
      });
    }

    expect(
      (inputs({ entities: many }).inputs["ips"] as Array<string>).length,
    ).toBe(50);
  });
});

describe("Run a runbook", () => {
  let started: Array<Parameters<typeof RunbookStarter.start>[0]>;

  beforeEach(() => {
    started = [];

    const runbook: Runbook = new Runbook();
    runbook._id = RUNBOOK_ID;
    runbook.name = "Block an address at the edge";
    runbook.projectId = PROJECT_ID;

    jest.spyOn(RunbookService, "findOneBy").mockResolvedValue(runbook as never);
    jest
      .spyOn(SecurityPlaybookTargets, "selectTargets")
      .mockImplementation((async (data: { entityType: SecurityEntityType }) => {
        return data.entityType === SecurityEntityType.IpAddress
          ? [target(SecurityEntityType.IpAddress, "203.0.113.9")]
          : [];
      }) as never);
    jest
      .spyOn(SecurityProtectedEntityService, "getRules")
      .mockImplementation((async (data: { entityType: SecurityEntityType }) => {
        return PROTECTED.filter((rule: ProtectedEntityRule): boolean => {
          return rule.type === data.entityType;
        });
      }) as never);
    jest
      .spyOn(SecurityPlaybookActions, "getTemplateValues")
      .mockResolvedValue(VALUES as never);
    jest.spyOn(RunbookStarter, "start").mockImplementation((async (
      request: Parameters<typeof RunbookStarter.start>[0],
    ) => {
      started.push(request);
      const execution: RunbookExecution = new RunbookExecution();
      execution._id = EXECUTION_ID;
      return { isStarted: true, execution };
    }) as never);
  });

  test("starts the runbook as a security playbook, with the case as its inputs, and links the run", async () => {
    const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(SecurityPlaybookActionType.RunRunbook, { runbookId: RUNBOOK_ID }),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.feedEventType).toBe(
      SecurityCaseFeedEventType.ResponseAction,
    );
    expect(outcome.summary.toString()).toContain(
      `[Block an address at the edge](https://oneuptime.example/dashboard/${PROJECT_ID.toString()}/runbooks/${RUNBOOK_ID}/executions/${EXECUTION_ID})`,
    );

    expect(started).toHaveLength(1);
    expect(started[0]!.trigger).toBe(RunbookTriggerType.SecurityPlaybook);
    expect(started[0]!.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(started[0]!.runbookId.toString()).toBe(RUNBOOK_ID);
    expect(started[0]!.inputs).toMatchObject({
      case_number: "SEC-12",
      ip: "203.0.113.9",
      playbook: "Contain web attacks",
    });
    expect(started[0]!.triggerDetails).toEqual({
      securityCaseId: CASE_ID.toString(),
      caseNumber: "SEC-12",
      playbookName: "Contain web attacks",
      playbookRunId: RUN_ID.toString(),
    });
  });

  test("says which protected users and hosts it left out of the inputs", async () => {
    const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(SecurityPlaybookActionType.RunRunbook, { runbookId: RUNBOOK_ID }),
    );

    expect(outcome.detailsInMarkdown?.toString()).toContain(
      "Left out of its inputs, as protected:",
    );
    expect(outcome.detailsInMarkdown?.toString()).toContain(
      "`break-glass-admin`",
    );
    expect(outcome.detailsInMarkdown?.toString()).toContain(
      "`dc-01.corp.example.com`",
    );
  });

  test("a runbook that is gone fails the step, saying so", async () => {
    jest.spyOn(RunbookService, "findOneBy").mockResolvedValue(null as never);

    const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(SecurityPlaybookActionType.RunRunbook, { runbookId: RUNBOOK_ID }),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Failed);
    expect(outcome.error).toBe("The runbook this step runs no longer exists.");
    expect(started).toHaveLength(0);
  });

  test("a runbook that will not start fails the step with the reason", async () => {
    jest.spyOn(RunbookStarter, "start").mockResolvedValue({
      isStarted: false,
      refusal: RunbookStartRefusal.TurnedOff,
    } as never);

    const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(SecurityPlaybookActionType.RunRunbook, { runbookId: RUNBOOK_ID }),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Failed);
    expect(outcome.error).toBe(
      'The runbook "Block an address at the edge" is turned off. Turn it on, or pick another runbook on the playbook.',
    );
  });

  test("every refusal reads as a sentence", () => {
    for (const refusal of Object.values(RunbookStartRefusal)) {
      expect(describeRunbookRefusal(refusal, "Block").length).toBeGreaterThan(
        20,
      );
    }
  });
});

describe("Preserve the evidence", () => {
  let pins: Array<RumSessionPin>;
  let notes: Array<SecurityCaseNote>;

  beforeEach(() => {
    pins = [];
    notes = [];

    // A case with no detection whose event could be kept, unless a test says otherwise.
    jest
      .spyOn(SecurityDetectionService, "findBy")
      .mockResolvedValue([] as never);

    jest
      .spyOn(RumSessionPinService, "create")
      .mockImplementation((async (args: { data: RumSessionPin }) => {
        pins.push(args.data);
        return args.data;
      }) as never);
    jest
      .spyOn(SecurityCaseNoteService, "create")
      .mockImplementation((async (args: { data: SecurityCaseNote }) => {
        notes.push(args.data);
        return args.data;
      }) as never);
  });

  test("with no request behind the case, there is nothing to keep, and it says so", async () => {
    jest.spyOn(SecurityCaseEvidence, "findRequests").mockResolvedValue([]);

    const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(SecurityPlaybookActionType.PreserveEvidence, {}),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(outcome.summary.toString()).toContain(
      "None of the case's events happened in a request OneUptime traced",
    );
    expect(pins).toHaveLength(0);
    expect(notes).toHaveLength(0);
  });

  test("pins each replay, notes every trace, replay and exception, and says what cannot be kept", async () => {
    jest.spyOn(SecurityCaseEvidence, "findRequests").mockResolvedValue([
      request({
        traceId: TRACE_ID,
        spanId: "00f067aa0ba902b7",
        sessionId: "session-1",
        exceptionFingerprint: "fp-e5e5",
        requestOutcome: "Reached Database",
        message: "SQL injection attempt: GET /login?id=1' or 1=1 → 500",
      }),
      request({ sessionId: "session-2" }),
    ]);
    const findSessionReplays: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SecurityCaseEvidence, "findSessionReplays")
      .mockResolvedValue([
        { sessionId: "session-1", rumApplicationId: RUM_APP_ID },
      ]);
    jest
      .spyOn(SecurityCaseEvidence, "findExceptions")
      .mockResolvedValue([exceptionGroup(EXCEPTION_ID)]);

    const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(SecurityPlaybookActionType.PreserveEvidence, {}),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.summary.toString()).toBe(
      "Kept 1 session replay, and noted 1 trace and 1 exception on the case.",
    );
    expect(outcome.detailsInMarkdown?.toString()).toContain(
      "Logs and traces cannot be held longer than the project keeps telemetry",
    );

    // Each distinct session is looked up once.
    expect(
      (findSessionReplays.mock.calls[0]![0] as { sessionIds: Array<string> })
        .sessionIds,
    ).toEqual(["session-1", "session-2"]);

    expect(pins).toHaveLength(1);
    expect(pins[0]!.sessionId).toBe("session-1");
    expect(pins[0]!.rumApplicationId?.toString()).toBe(RUM_APP_ID);
    expect(pins[0]!.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(pins[0]!.reason).toBe(
      "Evidence for security case SEC-12: SQL injection from 203.0.113.9",
    );

    expect(notes).toHaveLength(1);
    expect(notes[0]!.securityCaseId?.toString()).toBe(CASE_ID.toString());

    const note: string = notes[0]!.note || "";

    expect(note).toContain(
      `https://oneuptime.example/dashboard/${PROJECT_ID.toString()}/traces/view/${TRACE_ID}?spanId=00f067aa0ba902b7`,
    );
    expect(note).toContain("· Reached Database");
    expect(note).toContain(
      `https://oneuptime.example/dashboard/${PROJECT_ID.toString()}/rum/${RUM_APP_ID}/session-replay/session-1`,
    );
    expect(note).toContain("· kept past its retention");
    expect(note).toContain(
      `https://oneuptime.example/dashboard/${PROJECT_ID.toString()}/exceptions/${EXCEPTION_ID}`,
    );
    expect(note).toContain("SequelizeDatabaseError");
  });

  test("a replay that could not be pinned is still noted, as not kept, and the step goes on", async () => {
    jest
      .spyOn(SecurityCaseEvidence, "findRequests")
      .mockResolvedValue([request({ sessionId: "session-1" })]);
    jest
      .spyOn(SecurityCaseEvidence, "findSessionReplays")
      .mockResolvedValue([
        { sessionId: "session-1", rumApplicationId: RUM_APP_ID },
      ]);
    jest.spyOn(SecurityCaseEvidence, "findExceptions").mockResolvedValue([]);
    jest
      .spyOn(RumSessionPinService, "create")
      .mockRejectedValue(new Error("pins are full") as never);

    const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(SecurityPlaybookActionType.PreserveEvidence, {}),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.summary.toString()).toContain("Kept 0 session replays");
    expect(notes[0]!.note).toContain("· could not be kept");
  });

  // The detections' events, kept on the case's Evidence page past their retention.
  function detection(
    eventUid: string | undefined,
    lastSeenAt: string | undefined,
  ): SecurityDetection {
    const model: SecurityDetection = new SecurityDetection();

    if (eventUid !== undefined) {
      model.eventUid = eventUid;
    }

    if (lastSeenAt) {
      model.lastSeenAt = new Date(lastSeenAt);
    }

    return model;
  }

  test("keeps the events behind the case's detections on its Evidence page, each once, as OneUptime", async () => {
    const findBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SecurityDetectionService, "findBy")
      .mockResolvedValue([
        detection("finding-1", "2026-10-30T09:00:00.000Z"),
        detection("finding-1", "2026-10-30T09:05:00.000Z"),
        detection("finding-2", "2026-10-30T09:10:00.000Z"),
        // No event behind it, or no time to find it by: nothing to keep.
        detection(undefined, "2026-10-30T09:10:00.000Z"),
        detection("finding-3", undefined),
      ] as never);
    const addEvents: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SecurityCaseEvidenceService, "addEvents")
      .mockResolvedValue({
        added: ["finding-1", "finding-2"],
        alreadyOnCase: [],
        notFound: [],
      } as never);
    jest.spyOn(SecurityCaseEvidence, "findRequests").mockResolvedValue([]);

    const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(SecurityPlaybookActionType.PreserveEvidence, {}),
    );

    expect(
      (findBy.mock.calls[0]![0] as { query: JSONObject }).query,
    ).toEqual({ projectId: PROJECT_ID, securityCaseId: CASE_ID });

    const sent: {
      projectId: ObjectID;
      securityCaseId: ObjectID;
      events: Array<{ eventUid: string; time: Date }>;
      hunt: unknown;
      props: JSONObject;
    } = addEvents.mock.calls[0]![0] as never;

    expect(sent.projectId).toEqual(PROJECT_ID);
    expect(sent.securityCaseId).toEqual(CASE_ID);
    expect(sent.hunt).toBeNull();
    expect(sent.props).toEqual({ isRoot: true });
    expect(
      sent.events.map((event: { eventUid: string; time: Date }): string => {
        return `${event.eventUid} ${event.time.toISOString()}`;
      }),
    ).toEqual([
      "finding-1 2026-10-30T09:00:00.000Z",
      "finding-2 2026-10-30T09:10:00.000Z",
    ]);

    // With no request behind the case, the events are what it kept.
    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.summary.toString()).toBe(
      "Kept 2 events behind the case's detections on its Evidence page. None of the case's events happened in a request OneUptime traced, so there is no trace, session replay or exception to keep.",
    );
  });

  test("events the case keeps already are not kept twice, and with nothing else to keep the step is skipped", async () => {
    jest
      .spyOn(SecurityDetectionService, "findBy")
      .mockResolvedValue([
        detection("finding-1", "2026-10-30T09:00:00.000Z"),
      ] as never);
    jest.spyOn(SecurityCaseEvidenceService, "addEvents").mockResolvedValue({
      added: [],
      alreadyOnCase: ["finding-1"],
      notFound: [],
    } as never);
    jest.spyOn(SecurityCaseEvidence, "findRequests").mockResolvedValue([]);

    const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(SecurityPlaybookActionType.PreserveEvidence, {}),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(outcome.summary.toString()).not.toContain("Evidence page");
  });

  test("events that could not be kept are said, and the requests' evidence is still kept", async () => {
    jest
      .spyOn(SecurityDetectionService, "findBy")
      .mockResolvedValue([
        detection("finding-1", "2026-10-30T09:00:00.000Z"),
      ] as never);
    jest
      .spyOn(SecurityCaseEvidenceService, "addEvents")
      .mockRejectedValue(new Error("ClickHouse is unavailable") as never);
    jest
      .spyOn(SecurityCaseEvidence, "findRequests")
      .mockResolvedValue([request({ traceId: TRACE_ID })]);
    jest.spyOn(SecurityCaseEvidence, "findSessionReplays").mockResolvedValue([]);
    jest.spyOn(SecurityCaseEvidence, "findExceptions").mockResolvedValue([]);

    const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(SecurityPlaybookActionType.PreserveEvidence, {}),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.summary.toString()).toBe(
      "Kept 0 session replays, and noted 1 trace and 0 exceptions on the case.",
    );
    expect(outcome.detailsInMarkdown?.toString()).toContain(
      "The events behind the case's detections could not be kept: ClickHouse is unavailable",
    );
    expect(outcome.detailsInMarkdown?.toString()).toContain(
      "Logs and traces cannot be held longer than the project keeps telemetry",
    );
    expect(notes).toHaveLength(1);
  });
});

describe("the evidence note", () => {
  test("a request's own words are text: nothing an attacker wrote becomes a link or markup", () => {
    const note: string = buildEvidenceNoteMarkdown({
      caseNumber: "SEC-12",
      requests: [
        request({
          traceId: TRACE_ID,
          message: "[click me](javascript:alert(1)) **bold** <img src=x>",
        }),
      ],
      replays: [],
      exceptions: [],
      links: LINKS,
    }).toString();

    expect(note).not.toContain("[click me](javascript:alert(1))");
    // Escaped: Markdown reads "\<" as the character, never as a tag.
    expect(note).toContain("\\<img src=x>");
    expect(note).not.toMatch(/(^|[^\\])<img/);
    expect(note).toContain(
      `(https://oneuptime.example/dashboard/${PROJECT_ID.toString()}/traces/view/${TRACE_ID})`,
    );
  });

  test("a request with no words reads by its trace", () => {
    const note: string = buildEvidenceNoteMarkdown({
      caseNumber: "SEC-12",
      requests: [request({ traceId: TRACE_ID })],
      replays: [],
      exceptions: [],
      links: LINKS,
    }).toString();

    expect(note).toContain("Trace 4bf92f3577b34da6");
  });

  test("always says what OneUptime cannot hold longer", () => {
    expect(
      buildEvidenceNoteMarkdown({
        caseNumber: "",
        requests: [],
        replays: [],
        exceptions: [],
        links: LINKS,
      }).toString(),
    ).toContain(
      "Logs and traces are kept only as long as the project keeps telemetry",
    );
  });
});

describe("Post a status page announcement", () => {
  const CONFIG: JSONObject = {
    statusPageIds: [PAGE_ID, OTHER_PAGE_ID],
    announcementTitle: "We are investigating a security issue",
    announcementDescription: "Some sign-ins may be slower while we look.",
    notifySubscribers: false,
  };

  let created: Array<StatusPageAnnouncement>;

  beforeEach(() => {
    created = [];

    jest
      .spyOn(RuleRecordScope, "keepIdsInProject")
      .mockImplementation((async (data: { ids: Array<string> }) => {
        // The other page is another project's.
        return data.ids.filter((id: string): boolean => {
          return id === PAGE_ID;
        });
      }) as never);

    const page: StatusPage = new StatusPage();
    page._id = PAGE_ID;
    page.name = "Acme Status";

    jest.spyOn(StatusPageService, "findBy").mockResolvedValue([page] as never);
    jest
      .spyOn(StatusPageAnnouncementService, "create")
      .mockImplementation((async (args: { data: StatusPageAnnouncement }) => {
        created.push(args.data);
        const announcement: StatusPageAnnouncement =
          new StatusPageAnnouncement();
        announcement._id = ANNOUNCEMENT_ID;
        return announcement;
      }) as never);
  });

  test("posts what the step says, as it says it, on the project's pages only", async () => {
    const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(SecurityPlaybookActionType.PostStatusPageAnnouncement, CONFIG),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.feedEventType).toBe(SecurityCaseFeedEventType.Notification);
    expect(outcome.summary.toString()).toContain("**Acme Status**");
    expect(outcome.summary.toString()).toContain(
      `https://oneuptime.example/dashboard/${PROJECT_ID.toString()}/status-pages/announcements/${ANNOUNCEMENT_ID}`,
    );
    expect(outcome.detailsInMarkdown?.toString()).toBe(
      "The pages' subscribers were not notified.",
    );

    expect(created).toHaveLength(1);

    const announcement: StatusPageAnnouncement = created[0]!;

    expect(announcement.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(announcement.title).toBe("We are investigating a security issue");
    expect(announcement.description).toBe(
      "Some sign-ins may be slower while we look.",
    );
    // Nothing of the case reaches a public page.
    expect(announcement.description).not.toContain("SEC-12");
    expect(announcement.shouldStatusPageSubscribersBeNotified).toBe(false);
    expect(announcement.showAnnouncementAt).toBeInstanceOf(Date);
    expect(
      (announcement.statusPages || []).map((page: StatusPage): string => {
        return page._id?.toString() || "";
      }),
    ).toEqual([PAGE_ID]);
  });

  test("tells subscribers only when the step says so", async () => {
    const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(SecurityPlaybookActionType.PostStatusPageAnnouncement, {
        ...CONFIG,
        notifySubscribers: true,
      }),
    );

    expect(created[0]!.shouldStatusPageSubscribersBeNotified).toBe(true);
    expect(outcome.detailsInMarkdown?.toString()).toBe(
      "The pages' subscribers are being notified.",
    );
  });

  test("with none of its pages left, it fails and posts nothing", async () => {
    jest
      .spyOn(RuleRecordScope, "keepIdsInProject")
      .mockResolvedValue([] as never);

    const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(SecurityPlaybookActionType.PostStatusPageAnnouncement, CONFIG),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Failed);
    expect(outcome.error).toContain(
      "None of the status pages this step posts on exists any more.",
    );
    expect(created).toHaveLength(0);
  });
});

describe("Fix the code with AI", () => {
  let fixed: Array<string>;

  beforeEach(() => {
    fixed = [];

    jest
      .spyOn(SecurityCaseEvidence, "findRequests")
      .mockResolvedValue([
        request({ traceId: TRACE_ID, exceptionFingerprint: "fp-e5e5" }),
        request({ traceId: "trace-2", exceptionFingerprint: "fp-f6f6" }),
        request({ traceId: "trace-3", exceptionFingerprint: "fp-e5e5" }),
      ]);
    jest
      .spyOn(SecurityCaseEvidence, "findExceptions")
      .mockResolvedValue([
        exceptionGroup(EXCEPTION_ID),
        exceptionGroup(SECOND_EXCEPTION_ID, { exceptionType: "TypeError" }),
      ]);
    jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(true);
    jest
      .spyOn(TelemetryExceptionService, "getAIFixReadiness")
      .mockResolvedValue({ ready: true, checks: [] } as never);
    jest
      .spyOn(TelemetryExceptionService, "createCodeFixRunForException")
      .mockImplementation((async (params: {
        telemetryExceptionId: ObjectID;
      }) => {
        fixed.push(params.telemetryExceptionId.toString());
        return new AIRun();
      }) as never);
  });

  test("asks for a fix of each open exception the case's requests threw, each once", async () => {
    const findExceptions: ReturnType<typeof jest.spyOn> = jest.spyOn(
      SecurityCaseEvidence,
      "findExceptions",
    );

    const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(SecurityPlaybookActionType.FixWithAi, {}),
    );

    expect(
      (findExceptions.mock.calls[0]![0] as { fingerprints: Array<string> })
        .fingerprints,
    ).toEqual(["fp-e5e5", "fp-f6f6"]);
    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(outcome.feedEventType).toBe(
      SecurityCaseFeedEventType.ResponseAction,
    );
    expect(fixed).toEqual([EXCEPTION_ID, SECOND_EXCEPTION_ID]);
    expect(outcome.summary.toString()).toContain(
      `https://oneuptime.example/dashboard/${PROJECT_ID.toString()}/exceptions/${EXCEPTION_ID}/ai-assistance`,
    );
  });

  test("no exception behind the case: nothing to fix, skipped", async () => {
    jest
      .spyOn(SecurityCaseEvidence, "findRequests")
      .mockResolvedValue([request({ traceId: TRACE_ID })]);

    const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(SecurityPlaybookActionType.FixWithAi, {}),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(outcome.summary.toString()).toContain("there is no code to fix");
    expect(fixed).toHaveLength(0);
  });

  test("resolved and archived exceptions are left alone", async () => {
    jest
      .spyOn(SecurityCaseEvidence, "findExceptions")
      .mockResolvedValue([
        exceptionGroup(EXCEPTION_ID, { isResolved: true }),
        exceptionGroup(SECOND_EXCEPTION_ID, { isArchived: true }),
      ]);

    const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(SecurityPlaybookActionType.FixWithAi, {}),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(outcome.summary.toString()).toContain("resolved or archived");
    expect(fixed).toHaveLength(0);
  });

  test("with OneUptime AI off, it is skipped and says where to turn it on", async () => {
    jest.spyOn(AIService, "isProjectAIEnabled").mockResolvedValue(false);

    const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(SecurityPlaybookActionType.FixWithAi, {}),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(outcome.summary.toString()).toContain(
      "OneUptime AI is turned off for this project",
    );
    expect(fixed).toHaveLength(0);
  });

  test("an exception AI cannot take yet is skipped, naming what is missing, and the rest are fixed", async () => {
    jest
      .spyOn(TelemetryExceptionService, "getAIFixReadiness")
      .mockImplementation((async (params: {
        telemetryExceptionId: ObjectID;
      }) => {
        return params.telemetryExceptionId.toString() === EXCEPTION_ID
          ? {
              ready: false,
              checks: [
                {
                  id: "repositoryResolved",
                  ok: false,
                  title: "A repository that holds this code",
                  detail: "Connect it in Code.",
                },
                {
                  id: "llmProvider",
                  ok: true,
                  title: "An LLM provider",
                  detail: "",
                },
              ],
            }
          : { ready: true, checks: [] };
      }) as never);

    const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(SecurityPlaybookActionType.FixWithAi, {}),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Succeeded);
    expect(fixed).toEqual([SECOND_EXCEPTION_ID]);
    expect(outcome.detailsInMarkdown?.toString()).toContain(
      "missing A repository that holds this code",
    );
  });

  test("when no fix could be asked for, it is skipped with every reason, not failed", async () => {
    jest
      .spyOn(TelemetryExceptionService, "createCodeFixRunForException")
      .mockRejectedValue(
        new Error("An AI fix for this exception is already running.") as never,
      );

    const outcome: PlaybookStepOutcome = await SecurityPlaybookActions.execute(
      context(SecurityPlaybookActionType.FixWithAi, {}),
    );

    expect(outcome.status).toBe(SecurityPlaybookStepStatus.Skipped);
    expect(outcome.summary.toString()).toBe(
      "OneUptime AI could not take a fix for the exceptions behind the case.",
    );
    expect(outcome.detailsInMarkdown?.toString()).toContain(
      "An AI fix for this exception is already running.",
    );
  });

  test("a readiness with nothing failing still reads as a reason", () => {
    expect(describeMissingReadiness({ ready: false, checks: [] })).toBe(
      "OneUptime AI is not ready to fix it",
    );
  });
});
