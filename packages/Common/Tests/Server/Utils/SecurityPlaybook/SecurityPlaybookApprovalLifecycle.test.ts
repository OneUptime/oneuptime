import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import Queue from "../../../../Server/Infrastructure/Queue";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import AuditLogService from "../../../../Server/Services/AuditLogService";
import SecurityCaseFeedService from "../../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import SecurityDetectionService from "../../../../Server/Services/SecurityDetectionService";
import SecurityEventConnectionService from "../../../../Server/Services/SecurityEventConnectionService";
import SecurityPlaybookRunService from "../../../../Server/Services/SecurityPlaybookRunService";
import SecurityProtectedEntityService from "../../../../Server/Services/SecurityProtectedEntityService";
import ThreatIntelIndicatorService from "../../../../Server/Services/ThreatIntelIndicatorService";
import UserService from "../../../../Server/Services/UserService";
import WorkspaceLiveMessageService from "../../../../Server/Services/WorkspaceLiveMessageService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import ProductBrandingText from "../../../../Server/Utils/ProductBrandingText";
import SecurityPlaybookApprovalReader from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookApprovalReader";
import SecurityPlaybookContainment, {
  ContainmentTargetOutcome,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookContainment";
import SecurityPlaybookEngine from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookEngine";
import SecurityPlaybookRunDecision, {
  SecurityPlaybookApprovalChangedException,
} from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookRunDecision";
import WorkspaceSecurityPlaybookApprovalMessages from "../../../../Server/Utils/Workspace/WorkspaceSecurityPlaybookApprovalMessages";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityEventConnection from "../../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityPlaybookRun from "../../../../Models/DatabaseModels/SecurityPlaybookRun";
import User from "../../../../Models/DatabaseModels/User";
import WorkspaceLiveMessage from "../../../../Models/DatabaseModels/WorkspaceLiveMessage";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../../Types/JSON";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
import SecurityEventConnectorProvider from "../../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { SecurityPlaybookActionType } from "../../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookRunStatus, {
  SecurityPlaybookStepStatus,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { SecurityPlaybookStep } from "../../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookApprovalDecision,
  SecurityPlaybookStepResult,
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
} from "../../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import SecurityPlaybookTrigger from "../../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import { WorkspaceLiveMessageDestinationType } from "../../../../Types/Workspace/WorkspaceLiveMessageKey";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";

/*
 * WHAT COMES OF AN APPROVAL, AND EVERY COPY OF ITS MESSAGE ALONG THE WAY
 * (#10341).
 *
 * Approved from Slack, the run goes on through the playbook engine's
 * containment path - the target rule, the protected list as it is now, the
 * product's API - and every kept copy of the message says how it went: who
 * approved, when the step was done, what became of each target. Undone from
 * the case, the copies say who released what. Cancelled, they say so. A
 * decision made from a message about another step decides nothing. The
 * engine, the decision and the undo are the real ones; only the database,
 * the product's API and Slack's are stood in for.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "c8000000-0000-4000-8000-000000000001",
);
const JANE: ObjectID = new ObjectID("c8000000-0000-4000-8000-0000000000a1");
const CASE_ID: ObjectID = new ObjectID("c8000000-0000-4000-8000-0000000000b1");
const RUN_ID: ObjectID = new ObjectID("c8000000-0000-4000-8000-0000000000c1");
const CONNECTION_ID: string = "c8000000-0000-4000-8000-0000000000d1";

const STEPS: Array<SecurityPlaybookStep> = [
  {
    id: "contain",
    action: SecurityPlaybookActionType.SuspendOktaUser,
    config: { connectionId: CONNECTION_ID },
    requiresApproval: true,
    continueOnFailure: false,
    onlyIfThreatIntelMatched: false,
  },
];

const JANE_PROPS: DatabaseCommonInteractionProps = {
  userId: JANE,
  tenantId: PROJECT_ID,
};

interface RunState {
  status: SecurityPlaybookRunStatus;
  stepResults: Array<SecurityPlaybookStepResult>;
  currentStepIndex: number;
  completedAt?: Date | undefined;
}

let state: RunState;
let feed: Array<{ markdown: string; userId?: ObjectID | undefined }>;
let audited: number;
let edits: Array<{ channelId: string; blocks: string }>;
let undone: Array<string>;

function runModel(): SecurityPlaybookRun {
  const run: SecurityPlaybookRun = new SecurityPlaybookRun();
  run._id = RUN_ID.toString();
  run.projectId = PROJECT_ID;
  run.securityCaseId = CASE_ID;
  run.playbookName = "Contain account takeover";
  run.trigger = SecurityPlaybookTrigger.CaseOpened;
  run.status = state.status;
  run.steps = STEPS as never;
  run.stepResults = JSON.parse(JSON.stringify(state.stepResults)) as never;
  run.currentStepIndex = state.currentStepIndex;
  run.threatIntelMatched = false;
  run.startedAt = new Date("2026-11-20T10:40:00.000Z");

  if (state.completedAt) {
    run.completedAt = state.completedAt;
  }

  return run;
}

function waiting(): RunState {
  return {
    status: SecurityPlaybookRunStatus.WaitingForApproval,
    currentStepIndex: 0,
    stepResults: [
      {
        stepId: "contain",
        action: SecurityPlaybookActionType.SuspendOktaUser,
        status: SecurityPlaybookStepStatus.WaitingForApproval,
        targets: [
          {
            type: SecurityEntityType.User,
            value: "alice@acme.com",
            reason: SecurityPlaybookTargetReason.GroupedOn,
            state: SecurityPlaybookTargetState.Proposed,
          },
          {
            type: SecurityEntityType.User,
            value: "bob@acme.com",
            reason: SecurityPlaybookTargetReason.ThreatIntel,
            state: SecurityPlaybookTargetState.Proposed,
          },
        ],
      },
    ],
  };
}

// The edits of the kept copies, the newest last.
function latestEdit(): string {
  return edits[edits.length - 1]?.blocks || "";
}

beforeEach(() => {
  state = waiting();
  feed = [];
  audited = 0;
  edits = [];
  undone = [];

  jest
    .spyOn(SecurityPlaybookRunService, "findOneBy")
    .mockImplementation((async () => {
      return runModel();
    }) as never);
  jest
    .spyOn(SecurityPlaybookRunService, "findOneById")
    .mockImplementation((async () => {
      return runModel();
    }) as never);
  jest
    .spyOn(SecurityPlaybookRunService, "findOneUpdatableById")
    .mockImplementation((async () => {
      return runModel();
    }) as never);
  jest
    .spyOn(SecurityPlaybookRunService, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation((async (args: {
      data: JSONObject;
      expectedData: JSONObject;
    }) => {
      if (args.expectedData["status"] !== state.status) {
        return false;
      }

      if (args.data["status"]) {
        state.status = args.data["status"] as SecurityPlaybookRunStatus;
      }

      if (args.data["stepResults"]) {
        state.stepResults = JSON.parse(
          JSON.stringify(args.data["stepResults"]),
        ) as Array<SecurityPlaybookStepResult>;
      }

      if (args.data["completedAt"]) {
        state.completedAt = args.data["completedAt"] as unknown as Date;
      }

      return true;
    }) as never);
  jest
    .spyOn(SecurityPlaybookRunService, "updateOneById")
    .mockImplementation((async (args: { data: JSONObject }) => {
      if (args.data["stepResults"]) {
        state.stepResults = JSON.parse(
          JSON.stringify(args.data["stepResults"]),
        ) as Array<SecurityPlaybookStepResult>;
      }

      if (typeof args.data["currentStepIndex"] === "number") {
        state.currentStepIndex = args.data["currentStepIndex"] as number;
      }

      return 1;
    }) as never);
  jest
    .spyOn(SecurityPlaybookRunService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (args: { data: JSONObject }) => {
      if (args.data["completedAt"]) {
        state.completedAt = args.data["completedAt"] as unknown as Date;
      }
    }) as never);

  jest.spyOn(SecurityCaseService, "findOneBy").mockImplementation((async () => {
    const securityCase: SecurityCase = new SecurityCase();
    securityCase._id = CASE_ID.toString();
    securityCase.projectId = PROJECT_ID;
    securityCase.caseNumberWithPrefix = "SEC-12";
    securityCase.title = "Credential stuffing";
    securityCase.entities = [] as never;
    return securityCase;
  }) as never);
  jest
    .spyOn(SecurityCaseService, "findOneById")
    .mockImplementation((async () => {
      const securityCase: SecurityCase = new SecurityCase();
      securityCase.caseNumberWithPrefix = "SEC-12";
      return securityCase;
    }) as never);

  // The Okta connection the step acts through, and the protected list: empty.
  jest
    .spyOn(SecurityEventConnectionService, "findOneBy")
    .mockImplementation((async () => {
      const connection: SecurityEventConnection = new SecurityEventConnection();
      connection._id = CONNECTION_ID;
      connection.name = "Okta (acme)";
      connection.provider = SecurityEventConnectorProvider.OktaSystemLog;
      return connection;
    }) as never);
  jest
    .spyOn(SecurityEventConnectionService, "getConnectorSettings")
    .mockResolvedValue({} as never);
  jest
    .spyOn(SecurityProtectedEntityService, "getRules")
    .mockResolvedValue([] as never);

  // Okta itself: suspends and unsuspends as asked.
  jest
    .spyOn(
      SecurityPlaybookContainment as unknown as {
        act: (data: {
          values: Array<string>;
        }) => Promise<Map<string, ContainmentTargetOutcome>>;
      },
      "act",
    )
    .mockImplementation(async (data: { values: Array<string> }) => {
      return new Map<string, ContainmentTargetOutcome>(
        data.values.map((value: string): [string, ContainmentTargetOutcome] => {
          return [
            value,
            { state: SecurityPlaybookTargetState.Done, detail: "suspended" },
          ];
        }),
      );
    });
  jest
    .spyOn(SecurityPlaybookContainment, "undo")
    .mockImplementation((async (data: { value: string }) => {
      undone.push(data.value);
      return {
        state: SecurityPlaybookTargetState.Done,
        detail: "unsuspended",
      };
    }) as never);

  jest.spyOn(SecurityDetectionService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(ThreatIntelIndicatorService, "findActiveIndicatorsByValues")
    .mockResolvedValue([] as never);
  jest.spyOn(UserService, "findOneById").mockImplementation((async () => {
    const user: User = new User();
    user.name = new Name("Jane Doe");
    return user;
  }) as never);
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString("https://oneuptime.test/dashboard"));
  jest
    .spyOn(ProductBrandingText, "getProductName")
    .mockReturnValue("OneUptime");

  jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockImplementation((async (data: {
      feedInfoInMarkdown: string;
      userId?: ObjectID;
    }) => {
      feed.push({ markdown: data.feedInfoInMarkdown, userId: data.userId });
    }) as never);
  jest.spyOn(AuditLogService, "recordUpdate").mockImplementation((async () => {
    audited++;
  }) as never);
  jest.spyOn(Queue, "addJob").mockResolvedValue(undefined as never);

  // Two copies of the message were kept: #soc, and Jane's direct message.
  const keptCopies: Array<WorkspaceLiveMessage> = ["C0SOC", "D0JANE"].map(
    (channelId: string): WorkspaceLiveMessage => {
      const kept: WorkspaceLiveMessage = new WorkspaceLiveMessage();
      kept._id = ObjectID.generate().toString();
      kept.projectId = PROJECT_ID;
      kept.workspaceType = WorkspaceType.Slack;
      kept.messageKey = `SecurityPlaybookApproval:${RUN_ID.toString()}:0`;
      kept.destinationType = WorkspaceLiveMessageDestinationType.Channel;
      kept.channelId = channelId;
      kept.messageId = "1760000000.000200";
      kept.contentHash = "as-posted";
      kept.messageData = { language: "en" };
      return kept;
    },
  );

  jest
    .spyOn(WorkspaceLiveMessageService, "findByMessageKey")
    .mockImplementation((async () => {
      return keptCopies;
    }) as never);
  jest
    .spyOn(WorkspaceLiveMessageService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockImplementation((async () => {
      const auth: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
      auth.projectId = PROJECT_ID;
      auth.workspaceType = WorkspaceType.Slack;
      auth.authToken = "xoxb-project-token";
      auth.workspaceProjectId = "T0TEAM";
      return auth;
    }) as never);
  jest.spyOn(SlackUtil, "updateMessage").mockImplementation((async (data: {
    location: { channelId: string };
    messageBlocks: Array<unknown>;
  }) => {
    edits.push({
      channelId: data.location.channelId,
      blocks: JSON.stringify(data.messageBlocks),
    });
  }) as never);
  jest
    .spyOn(Semaphore, "lock")
    .mockRejectedValue(new Error("no Valkey in this test"));
});

afterEach(async () => {
  await WorkspaceSecurityPlaybookApprovalMessages.settle();
  jest.restoreAllMocks();
});

describe("an approval, from Slack to the product and back", () => {
  test("approved, the step contains through the engine, every copy says it was done, and an undo from the case says who released what", async () => {
    await SecurityPlaybookRunDecision.decide({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      decision: SecurityPlaybookApprovalDecision.Approved,
      props: JANE_PROPS,
      from: WorkspaceType.Slack,
    });
    await WorkspaceSecurityPlaybookApprovalMessages.settle();

    expect(state.status).toBe(SecurityPlaybookRunStatus.Queued);
    // Both copies: approved, and running.
    expect(
      edits.map((edit: { channelId: string }): string => {
        return edit.channelId;
      }),
    ).toEqual(["C0SOC", "D0JANE"]);
    expect(latestEdit()).toContain("Approved by Jane Doe");
    expect(latestEdit()).toContain("Running now.");

    // The worker runs it: the engine's containment path, the product's API.
    await SecurityPlaybookEngine.executeRun(RUN_ID);
    await WorkspaceSecurityPlaybookApprovalMessages.settle();

    expect(state.status).toBe(SecurityPlaybookRunStatus.Succeeded);
    expect(
      state.stepResults[0]!.targets!.map(
        (target: { value: string; state: string }): Array<string> => {
          return [target.value, target.state];
        },
      ),
    ).toEqual([
      ["alice@acme.com", SecurityPlaybookTargetState.Done],
      ["bob@acme.com", SecurityPlaybookTargetState.Done],
    ]);

    // Every copy says it was done, and what became of each target.
    expect(
      edits.slice(-2).map((edit: { channelId: string }): string => {
        return edit.channelId;
      }),
    ).toEqual(["C0SOC", "D0JANE"]);
    expect(latestEdit()).toMatch(
      /Approved by Jane Doe at \{\{TIME\(.+\)\}\}\*\* Done at \{\{TIME\(.+\)\}\}\./,
    );
    expect(latestEdit()).toContain("`alice@acme.com`: done · suspended");
    expect(latestEdit()).toContain("`bob@acme.com`: done · suspended");

    // The timeline, the approval then the step.
    expect(feed[0]!.markdown).toContain("👍 Approved step 1");
    expect(feed[0]!.markdown).toContain("from Slack");
    expect(feed[0]!.userId?.toString()).toBe(JANE.toString());

    // Released from the case, through the step's own connection.
    await SecurityPlaybookRunDecision.undoTarget({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      stepId: "contain",
      value: "alice@acme.com",
      props: JANE_PROPS,
    });
    await WorkspaceSecurityPlaybookApprovalMessages.settle();

    expect(undone).toEqual(["alice@acme.com"]);
    expect(state.stepResults[0]!.targets![0]).toMatchObject({
      value: "alice@acme.com",
      state: SecurityPlaybookTargetState.Undone,
      undoneByUserId: JANE.toString(),
    });
    expect(latestEdit()).toMatch(
      /`alice@acme\.com`: undone by Jane Doe at \{\{TIME\(.+\)\}\}/,
    );
    expect(latestEdit()).toContain("`bob@acme.com`: done · suspended");
    expect(
      feed.some((item: { markdown: string }): boolean => {
        return item.markdown.startsWith(
          "↩️ Unsuspend the user in Okta: `alice@acme.com` unsuspended",
        );
      }),
    ).toBe(true);
    // The approval and the undo, each in the audit log as Jane.
    expect(audited).toBe(2);
  });

  test("decided in the Dashboard, every chat copy follows too", async () => {
    await SecurityPlaybookRunDecision.decide({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      decision: SecurityPlaybookApprovalDecision.Rejected,
      props: JANE_PROPS,
    });
    await WorkspaceSecurityPlaybookApprovalMessages.settle();

    expect(feed[0]!.markdown).toBe(
      "👎 Rejected step 1 (Suspend the user in Okta) of playbook **Contain account takeover**, which ends the run.",
    );
    expect(edits).toHaveLength(2);
    expect(latestEdit()).toContain("Rejected by Jane Doe");
    expect(latestEdit()).toContain("Nothing was done.");
  });

  test("cancelled while it waits, every copy says so and asks nobody", async () => {
    state.status = SecurityPlaybookRunStatus.Cancelled;

    await SecurityPlaybookRunService.recordCancellation({
      runId: RUN_ID,
      userId: JANE,
    });
    await WorkspaceSecurityPlaybookApprovalMessages.settle();

    expect(edits).toHaveLength(2);
    expect(latestEdit()).toContain(
      "No longer waiting for approval: the run was cancelled.",
    );
    expect(latestEdit()).not.toContain("ApproveSecurityPlaybookStep");
  });

  test("approved, then cancelled before the step ran, the copies say the step never ran", async () => {
    await SecurityPlaybookRunDecision.decide({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      decision: SecurityPlaybookApprovalDecision.Approved,
      props: JANE_PROPS,
      from: WorkspaceType.Slack,
    });
    await WorkspaceSecurityPlaybookApprovalMessages.settle();

    state.status = SecurityPlaybookRunStatus.Cancelled;

    await SecurityPlaybookRunService.recordCancellation({ runId: RUN_ID });
    await WorkspaceSecurityPlaybookApprovalMessages.settle();

    expect(latestEdit()).toContain("Approved by Jane Doe");
    expect(latestEdit()).toContain(
      "The run was cancelled before this step ran.",
    );
  });

  test("a decision from a message about other targets than the step proposes decides nothing, and writes nothing", async () => {
    const digest: string = SecurityPlaybookApprovalReader.getTargetsDigest({
      step: STEPS[0]!,
      targets: waiting().stepResults[0]!.targets,
    });

    state.stepResults[0]!.targets!.pop();

    await expect(
      SecurityPlaybookRunDecision.decide({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        decision: SecurityPlaybookApprovalDecision.Approved,
        props: JANE_PROPS,
        from: WorkspaceType.Slack,
        expected: { stepId: "contain", targetsDigest: digest },
      }),
    ).rejects.toBeInstanceOf(SecurityPlaybookApprovalChangedException);

    await expect(
      SecurityPlaybookRunDecision.decide({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        decision: SecurityPlaybookApprovalDecision.Approved,
        props: JANE_PROPS,
        from: WorkspaceType.Slack,
        expected: { stepId: "another-step", targetsDigest: digest },
      }),
    ).rejects.toBeInstanceOf(SecurityPlaybookApprovalChangedException);

    await WorkspaceSecurityPlaybookApprovalMessages.settle();

    expect(state.status).toBe(SecurityPlaybookRunStatus.WaitingForApproval);
    expect(feed).toEqual([]);
    expect(audited).toBe(0);
    expect(edits).toEqual([]);
  });
});

describe("what a step's approval round is held to", () => {
  test("the digest names the action, the connection and the proposed targets - and nothing else", () => {
    const targets: Array<{
      value: string;
      state: SecurityPlaybookTargetState;
    }> = [
      { value: "Alice@acme.com", state: SecurityPlaybookTargetState.Proposed },
      { value: "bob@acme.com", state: SecurityPlaybookTargetState.Proposed },
      { value: "ceo@acme.com", state: SecurityPlaybookTargetState.Protected },
    ];
    const digest: string = SecurityPlaybookApprovalReader.getTargetsDigest({
      step: STEPS[0]!,
      targets,
    });

    expect(digest).toHaveLength(22);
    // The same proposed targets, in another order and case: the same round.
    expect(
      SecurityPlaybookApprovalReader.getTargetsDigest({
        step: STEPS[0]!,
        targets: [
          targets[1]!,
          targets[2]!,
          { ...targets[0]!, value: "alice@ACME.com" },
        ],
      }),
    ).toBe(digest);
    // A protected target comes and goes without changing what is acted on.
    expect(
      SecurityPlaybookApprovalReader.getTargetsDigest({
        step: STEPS[0]!,
        targets: targets.slice(0, 2),
      }),
    ).toBe(digest);
    // Another target, another action or another connection: another round.
    expect(
      SecurityPlaybookApprovalReader.getTargetsDigest({
        step: STEPS[0]!,
        targets: [
          ...targets,
          {
            value: "mallory@acme.com",
            state: SecurityPlaybookTargetState.Proposed,
          },
        ],
      }),
    ).not.toBe(digest);
    expect(
      SecurityPlaybookApprovalReader.getTargetsDigest({
        step: {
          ...STEPS[0]!,
          action: SecurityPlaybookActionType.EndOktaSessions,
        },
        targets,
      }),
    ).not.toBe(digest);
    expect(
      SecurityPlaybookApprovalReader.getTargetsDigest({
        step: {
          ...STEPS[0]!,
          config: { connectionId: ObjectID.generate().toString() },
        },
        targets,
      }),
    ).not.toBe(digest);
  });

  test("where it stands, from the run and its step", async () => {
    const result: SecurityPlaybookStepResult = waiting().stepResults[0]!;

    expect(
      await SecurityPlaybookApprovalReader.getStanding({
        run: { status: SecurityPlaybookRunStatus.WaitingForApproval },
        result,
      }),
    ).toEqual({ kind: "Waiting" });
    expect(
      await SecurityPlaybookApprovalReader.getStanding({
        run: { status: SecurityPlaybookRunStatus.Failed },
        result,
      }),
    ).toEqual({ kind: "No Longer Waiting", isRunCancelled: false });

    const approved: SecurityPlaybookStepResult = {
      ...result,
      status: SecurityPlaybookStepStatus.Failed,
      error: "Okta answered 403",
      completedAt: "2026-11-20T10:43:05.000Z",
      approval: {
        decision: SecurityPlaybookApprovalDecision.Approved,
        decidedByUserId: JANE.toString(),
        decidedAt: "2026-11-20T10:43:00.000Z",
      },
    };

    expect(
      await SecurityPlaybookApprovalReader.getStanding({
        run: { status: SecurityPlaybookRunStatus.Failed },
        result: approved,
      }),
    ).toEqual({
      kind: "Approved",
      deciderName: "Jane Doe",
      decidedAt: new Date("2026-11-20T10:43:00.000Z"),
      progress: "Failed",
      completedAt: new Date("2026-11-20T10:43:05.000Z"),
      error: "Okta answered 403",
    });
    expect(
      (
        await SecurityPlaybookApprovalReader.getStanding({
          run: { status: SecurityPlaybookRunStatus.Failed },
          result: { ...approved, status: SecurityPlaybookStepStatus.Pending },
        })
      ).progress,
    ).toBe("Stopped Before Run");
  });

  test("the step an approval is about when nobody names one: the one waited on, else the last one asked about", () => {
    const steps: Array<SecurityPlaybookStep> = [
      { ...STEPS[0]!, id: "contain" },
      { ...STEPS[0]!, id: "note", requiresApproval: false },
      { ...STEPS[0]!, id: "contain-again" },
    ];
    const result: (
      stepId: string,
      status: SecurityPlaybookStepStatus,
      approved?: boolean,
    ) => SecurityPlaybookStepResult = (
      stepId: string,
      status: SecurityPlaybookStepStatus,
      approved: boolean = false,
    ): SecurityPlaybookStepResult => {
      return {
        stepId,
        action: SecurityPlaybookActionType.SuspendOktaUser,
        status,
        ...(approved
          ? {
              approval: {
                decision: SecurityPlaybookApprovalDecision.Approved,
                decidedByUserId: JANE.toString(),
                decidedAt: "2026-11-20T10:43:00.000Z",
              },
            }
          : {}),
      };
    };
    const askedIn: (
      status: SecurityPlaybookRunStatus,
      currentStepIndex: number,
      results: Array<SecurityPlaybookStepResult>,
    ) => number = (
      status: SecurityPlaybookRunStatus,
      currentStepIndex: number,
      results: Array<SecurityPlaybookStepResult>,
    ): number => {
      const run: SecurityPlaybookRun = new SecurityPlaybookRun();
      run.status = status;
      run.currentStepIndex = currentStepIndex;
      return SecurityPlaybookApprovalReader.getAskedStepIndex({
        run,
        steps,
        results,
      });
    };

    // Waiting: the step it waits on.
    expect(
      askedIn(SecurityPlaybookRunStatus.WaitingForApproval, 2, [
        result("contain", SecurityPlaybookStepStatus.Succeeded, true),
        result("note", SecurityPlaybookStepStatus.Succeeded),
        result("contain-again", SecurityPlaybookStepStatus.WaitingForApproval),
      ]),
    ).toBe(2);
    // Finished past its last step: the last step it asked about.
    expect(
      askedIn(SecurityPlaybookRunStatus.Succeeded, 3, [
        result("contain", SecurityPlaybookStepStatus.Succeeded, true),
        result("note", SecurityPlaybookStepStatus.Succeeded),
        result("contain-again", SecurityPlaybookStepStatus.Skipped),
      ]),
    ).toBe(0);
    // Cancelled while it waited: the step it stopped at.
    expect(
      askedIn(SecurityPlaybookRunStatus.Cancelled, 2, [
        result("contain", SecurityPlaybookStepStatus.Succeeded, true),
        result("note", SecurityPlaybookStepStatus.Succeeded),
        result("contain-again", SecurityPlaybookStepStatus.Pending),
      ]),
    ).toBe(2);
    // A run that asked nobody: the step it is on.
    expect(
      askedIn(SecurityPlaybookRunStatus.Failed, 1, [
        result("contain", SecurityPlaybookStepStatus.Skipped),
        result("note", SecurityPlaybookStepStatus.Failed),
        result("contain-again", SecurityPlaybookStepStatus.Pending),
      ]),
    ).toBe(1);
  });

  test("who asked: the person who ran the playbook by hand, else the playbook and what started it", async () => {
    expect(
      await SecurityPlaybookApprovalReader.getSource({
        playbookName: "Contain",
        triggeredByUserId: JANE,
        trigger: SecurityPlaybookTrigger.Manual,
      }),
    ).toEqual({
      kind: "Person",
      playbookName: "Contain",
      personName: "Jane Doe",
    });
    expect(
      await SecurityPlaybookApprovalReader.getSource({
        playbookName: "Contain",
        trigger: SecurityPlaybookTrigger.TriagedAsLikelyMalicious,
      }),
    ).toEqual({
      kind: "Playbook",
      playbookName: "Contain",
      trigger: SecurityPlaybookTrigger.TriagedAsLikelyMalicious,
    });
  });
});
