import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import crypto from "crypto";
import http from "http";
import { AddressInfo } from "net";
import express from "express";
import API from "../../../Utils/API";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Name from "../../../Types/Name";
import Permission, { UserPermission } from "../../../Types/Permission";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import { SecurityPlaybookActionType } from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookRunStatus, {
  SecurityPlaybookStepStatus,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { SecurityPlaybookStep } from "../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookApprovalDecision,
  SecurityPlaybookStepResult,
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import SecurityPlaybookTrigger from "../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import { WorkspaceLiveMessageDestinationType } from "../../../Types/Workspace/WorkspaceLiveMessageKey";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityPlaybookRun from "../../../Models/DatabaseModels/SecurityPlaybookRun";
import User from "../../../Models/DatabaseModels/User";
import WorkspaceLiveMessage from "../../../Models/DatabaseModels/WorkspaceLiveMessage";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import Queue from "../../../Server/Infrastructure/Queue";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import AuditLogService from "../../../Server/Services/AuditLogService";
import SecurityCaseFeedService from "../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import SecurityDetectionService from "../../../Server/Services/SecurityDetectionService";
import SecurityEventConnectionService from "../../../Server/Services/SecurityEventConnectionService";
import SecurityPlaybookRunService from "../../../Server/Services/SecurityPlaybookRunService";
import ThreatIntelIndicatorService from "../../../Server/Services/ThreatIntelIndicatorService";
import UserService from "../../../Server/Services/UserService";
import WorkspaceLiveMessageService from "../../../Server/Services/WorkspaceLiveMessageService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import ProductBrandingText from "../../../Server/Utils/ProductBrandingText";
import SecurityPlaybookApprovalReader from "../../../Server/Utils/SecurityPlaybook/SecurityPlaybookApprovalReader";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceProductRefusal from "../../../Server/Utils/Workspace/WorkspaceProductRefusal";
import WorkspaceSecurityPlaybookApproval from "../../../Server/Utils/Workspace/WorkspaceSecurityPlaybookApproval";
import WorkspaceSecurityPlaybookApprovalMessages from "../../../Server/Utils/Workspace/WorkspaceSecurityPlaybookApprovalMessages";
import { OneUptimeRequest } from "../../../Server/Utils/Express";

/*
 * APPROVING A PLAYBOOK STEP FROM SLACK, THROUGH SLACK'S OWN SIGNED REQUESTS
 * (#10341).
 *
 * An approval is containment, so these post what Slack posts - a button's
 * press, a form's submission - SIGNED with the app's signing secret, through
 * the real SlackAuthorization middleware (the signature, the five-minute
 * window, a delivery never seen before), the real SlackAPI router, the
 * Slack account's link to its member, the approval's own checks, and the
 * run's own decision. Only the database under them and Slack's HTTP API
 * are stood in for. Every write and every request to Slack is pinned.
 */

const SIGNING_SECRET: string = "test-slack-signing-secret";

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    SlackAppSigningSecret: "test-slack-signing-secret",
  };
});

jest.mock("../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: (
      jest.requireActual("./WorkspaceOAuthTestHelpers") as {
        createInMemoryGlobalCache: () => unknown;
      }
    ).createInMemoryGlobalCache(),
  };
});

const DASHBOARD_URL: string = "https://oneuptime.test/dashboard";
const SLACK_TEAM_ID: string = "T0TEAM";
const SLACK_USER_ID: string = "U0SIMON";
const SOC_CHANNEL_ID: string = "C0SOC";
const SIMON_DM_CHANNEL_ID: string = "D0SIMON";
const TRIGGER_ID: string = "1760000000.trigger";
const PRESS_RESPONSE_URL: string =
  "https://hooks.slack.com/actions/T0TEAM/1760000000/approveAbc";

const PROJECT_ID: ObjectID = new ObjectID(
  "c6000000-0000-4000-8000-000000000001",
);
const SIMON: ObjectID = new ObjectID("c6000000-0000-4000-8000-0000000000a1");
const NAWAZ: ObjectID = new ObjectID("c6000000-0000-4000-8000-0000000000a2");
const CASE_ID: ObjectID = new ObjectID("c6000000-0000-4000-8000-0000000000b1");
const RUN_ID: ObjectID = new ObjectID("c6000000-0000-4000-8000-0000000000c1");
const CONNECTION_ID: string = "c6000000-0000-4000-8000-0000000000d1";

const NAMES: Record<string, string> = {
  [SIMON.toString()]: "Simon Lee",
  [NAWAZ.toString()]: "Nawaz Dhandala",
};

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

// A member of the project holding these permissions, as the gate reads them.
function propsWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: SIMON,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission: permission,
              isBlockPermission: false,
              labelIds: [],
            };
          },
        ),
      },
    },
  };
}

function waitingResults(): Array<SecurityPlaybookStepResult> {
  return [
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
        {
          type: SecurityEntityType.User,
          value: "ceo@acme.com",
          reason: SecurityPlaybookTargetReason.GroupedOn,
          state: SecurityPlaybookTargetState.Protected,
          protectedBy: "ceo@acme.com",
        },
      ],
    },
  ];
}

interface SlackCall {
  url: string;
  data: JSONObject;
}

interface RoutePort {
  port: number;
  close: () => Promise<void>;
}

interface RouteAnswer {
  status: number;
  text: string;
}

interface SignedRequest {
  body: string;
  headers: Record<string, string>;
}

async function startSlackApp(): Promise<RoutePort> {
  const SlackAPI: { new (): { getRouter: () => express.Router } } = (
    (await import("../../../Server/API/SlackAPI")) as unknown as {
      default: { new (): { getRouter: () => express.Router } };
    }
  ).default;

  const app: express.Express = express();

  // The bytes Slack signed, kept as the App's own parser keeps them.
  app.use(
    express.urlencoded({
      extended: true,
      verify: (req: http.IncomingMessage, _res: unknown, buf: Buffer) => {
        (req as unknown as OneUptimeRequest).rawFormUrlEncodedBody =
          buf.toString();
        (req as unknown as OneUptimeRequest).rawBody = buf.toString();
      },
    }),
  );
  app.use(express.json());
  app.use("/api", new SlackAPI().getRouter());

  const server: http.Server = http.createServer(app);

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    port: (server.address() as AddressInfo).port,
    close: (): Promise<void> => {
      return new Promise<void>((resolve: () => void) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

// A request as Slack signs it: v0, the timestamp and the body, with the app's secret.
function signed(data: {
  fields: Record<string, string>;
  secret?: string;
  timestamp?: number;
}): SignedRequest {
  const body: string = new globalThis.URLSearchParams(data.fields).toString();
  const timestamp: string = String(
    data.timestamp ?? Math.floor(Date.now() / 1000),
  );
  const signature: string = `v0=${crypto
    .createHmac("sha256", data.secret || SIGNING_SECRET)
    .update(`v0:${timestamp}:${body}`)
    .digest("hex")}`;

  return {
    body,
    headers: {
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": signature,
    },
  };
}

function post(port: number, request: SignedRequest): Promise<RouteAnswer> {
  return new Promise<RouteAnswer>(
    (
      resolve: (answer: RouteAnswer) => void,
      reject: (error: Error) => void,
    ) => {
      const outgoing: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: port,
          path: "/api/slack/interactive",
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "content-length": Buffer.byteLength(request.body),
            ...request.headers,
          },
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          response.on("end", () => {
            resolve({
              status: response.statusCode || 0,
              text: Buffer.concat(chunks).toString("utf8"),
            });
          });
        },
      );

      outgoing.setTimeout(20000, () => {
        outgoing.destroy(new Error("no answer"));
      });
      outgoing.on("error", reject);
      outgoing.write(request.body);
      outgoing.end();
    },
  );
}

// What Slack posts when a button of the approval's message is pressed.
function buttonPress(data: {
  actionId: string;
  value: string;
  channelId?: string;
}): Record<string, string> {
  const channelId: string = data.channelId || SOC_CHANNEL_ID;

  return {
    payload: JSON.stringify({
      type: "block_actions",
      user: { id: SLACK_USER_ID, username: "simon", name: "simon" },
      team: { id: SLACK_TEAM_ID },
      channel: { id: channelId, name: "soc" },
      container: {
        type: "message",
        channel_id: channelId,
        message_ts: "1760000000.000200",
      },
      message: { ts: "1760000000.000200" },
      response_url: PRESS_RESPONSE_URL,
      trigger_id: TRIGGER_ID,
      actions: [
        {
          type: "button",
          action_id: data.actionId,
          block_id: "approval-buttons",
          value: data.value,
          action_ts: `${Date.now()}.000300`,
        },
      ],
    }),
  };
}

// What Slack posts when Approve Some's form is submitted, with its boxes.
function formSubmission(data: {
  privateMetadata: string;
  ticked: Array<string>;
  fields: Array<string>;
}): Record<string, string> {
  const values: JSONObject = {};

  for (const field of data.fields) {
    values[field] = {
      [field]: {
        type: "checkboxes",
        selected_options: data.ticked.includes(field)
          ? [{ value: "value", text: { text: "x" } }]
          : [],
      },
    };
  }

  return {
    payload: JSON.stringify({
      type: "view_submission",
      team: { id: SLACK_TEAM_ID },
      user: { id: SLACK_USER_ID, username: "simon", name: "simon" },
      trigger_id: TRIGGER_ID,
      view: {
        type: "modal",
        callback_id: "SubmitApproveSomeSecurityPlaybookStep",
        private_metadata: data.privateMetadata,
        state: { values },
      },
    }),
  };
}

describe("a playbook step's approval, pressed in Slack", () => {
  let app: RoutePort;
  let slackCalls: Array<SlackCall>;
  let run: SecurityPlaybookRun;
  let linkedUser: ObjectID | null;
  let memberProps: DatabaseCommonInteractionProps;
  let isCaseReadable: boolean;
  let decisions: Array<JSONObject>;
  let auditUpdates: Array<{ props: DatabaseCommonInteractionProps }>;
  let feed: Array<{ markdown: string; userId?: ObjectID | undefined }>;
  let queued: Array<string>;
  let keptCopies: Array<WorkspaceLiveMessage>;
  let reads: number;

  // The round the message was drawn for, as its buttons carry it.
  function roundValue(): string {
    return WorkspaceSecurityPlaybookApproval.encodeValue({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      securityCaseId: CASE_ID,
      stepIndex: 0,
      stepId: "contain",
      targetsDigest: SecurityPlaybookApprovalReader.getTargetsDigest({
        step: STEPS[0]!,
        targets: waitingResults()[0]!.targets,
      }),
    });
  }

  function answers(): Array<string> {
    return slackCalls
      .filter((call: SlackCall): boolean => {
        return call.url === PRESS_RESPONSE_URL;
      })
      .map((call: SlackCall): string => {
        return String(call.data["text"]);
      });
  }

  function edits(): Array<SlackCall> {
    return slackCalls.filter((call: SlackCall): boolean => {
      return call.url === "https://slack.com/api/chat.update";
    });
  }

  beforeAll(async () => {
    app = await startSlackApp();
  }, 600000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    slackCalls = [];
    linkedUser = SIMON;
    memberProps = propsWith([Permission.SecurityMember]);
    isCaseReadable = true;
    decisions = [];
    auditUpdates = [];
    feed = [];
    queued = [];
    reads = 0;

    (
      jest.requireMock("../../../Server/Infrastructure/GlobalCache") as {
        default: { store: Map<string, unknown> };
      }
    ).default.store.clear();

    run = new SecurityPlaybookRun();
    run._id = RUN_ID.toString();
    run.projectId = PROJECT_ID;
    run.securityCaseId = CASE_ID;
    run.playbookName = "Contain account takeover";
    run.status = SecurityPlaybookRunStatus.WaitingForApproval;
    run.trigger = SecurityPlaybookTrigger.CaseOpened;
    run.steps = STEPS as never;
    run.stepResults = waitingResults() as never;
    run.currentStepIndex = 0;

    // Two copies of the message were posted and kept: #soc, and Simon's DM.
    keptCopies = [SOC_CHANNEL_ID, SIMON_DM_CHANNEL_ID].map(
      (channelId: string, index: number): WorkspaceLiveMessage => {
        const kept: WorkspaceLiveMessage = new WorkspaceLiveMessage();
        kept._id = ObjectID.generate().toString();
        kept.projectId = PROJECT_ID;
        kept.workspaceType = WorkspaceType.Slack;
        kept.messageKey = `SecurityPlaybookApproval:${RUN_ID.toString()}:0`;
        kept.destinationType = WorkspaceLiveMessageDestinationType.Channel;
        kept.channelId = channelId;
        kept.messageId = `1760000000.00020${index}`;
        kept.contentHash = "as-posted";
        kept.messageData =
          index === 0
            ? { language: "en" }
            : {
                language: "en",
                directMessageUserId: SIMON.toString(),
                workspaceProjectId: SLACK_TEAM_ID,
              };
        return kept;
      },
    );

    const projectAuth: () => WorkspaceProjectAuthToken =
      (): WorkspaceProjectAuthToken => {
        const auth: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
        auth.projectId = PROJECT_ID;
        auth.workspaceType = WorkspaceType.Slack;
        auth.authToken = "xoxb-project-token";
        auth.workspaceProjectId = SLACK_TEAM_ID;
        auth.miscData = { botUserId: "B0BOT" } as never;
        return auth;
      };

    // ---- The workspace, and the Slack account's member ----
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
      .mockImplementation((async () => {
        return projectAuth();
      }) as never);
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockImplementation((async () => {
        return [projectAuth()];
      }) as never);
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
      .mockImplementation((async () => {
        return projectAuth();
      }) as never);
    jest
      .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
      .mockImplementation((async () => {
        if (!linkedUser) {
          return null;
        }

        const userAuth: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
        userAuth.userId = linkedUser;
        userAuth.authToken = "xoxp-user-token";
        return userAuth;
      }) as never);
    jest
      .spyOn(WorkspaceActionAuthorization, "isProjectMember")
      .mockResolvedValue(true);
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockImplementation(async () => {
        return memberProps;
      });

    // ---- The run, its case and what the step acts through ----
    jest
      .spyOn(SecurityPlaybookRunService, "findOneBy")
      .mockImplementation((async () => {
        reads++;
        return run;
      }) as never);
    jest
      .spyOn(SecurityPlaybookRunService, "findOneUpdatableById")
      .mockImplementation((async () => {
        return run;
      }) as never);
    // One compare-and-set from Waiting for Approval: two presses decide once.
    jest
      .spyOn(SecurityPlaybookRunService, "compareAndSetColumnsByIdWithoutHooks")
      .mockImplementation((async (args: {
        data: JSONObject;
        expectedData: JSONObject;
      }) => {
        if (run.status !== args.expectedData["status"]) {
          return false;
        }

        decisions.push(args.data);
        run.status = args.data["status"] as SecurityPlaybookRunStatus;
        run.stepResults = args.data["stepResults"] as never;
        return true;
      }) as never);
    jest
      .spyOn(SecurityCaseService, "findOneBy")
      .mockImplementation((async (findOneBy: {
        props: DatabaseCommonInteractionProps;
      }) => {
        if (!findOneBy.props.isRoot && !isCaseReadable) {
          return null;
        }

        const securityCase: SecurityCase = new SecurityCase();
        securityCase._id = CASE_ID.toString();
        securityCase.caseNumberWithPrefix = "SEC-12";
        securityCase.title = "Credential stuffing";
        securityCase.entities = [] as never;
        return securityCase;
      }) as never);
    jest
      .spyOn(SecurityEventConnectionService, "findOneBy")
      .mockImplementation((async () => {
        const connection: SecurityEventConnection =
          new SecurityEventConnection();
        connection.name = "Okta (acme)";
        return connection;
      }) as never);
    jest
      .spyOn(SecurityDetectionService, "findBy")
      .mockResolvedValue([] as never);
    jest
      .spyOn(ThreatIntelIndicatorService, "findActiveIndicatorsByValues")
      .mockResolvedValue([] as never);
    jest.spyOn(UserService, "findOneById").mockImplementation((async (data: {
      id: ObjectID;
    }) => {
      const user: User = new User();
      user.id = data.id;
      user.name = new Name(NAMES[data.id.toString()] || "Someone");
      return user;
    }) as never);
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString(DASHBOARD_URL));
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("OneUptime");

    // ---- What the decision writes ----
    jest
      .spyOn(AuditLogService, "recordUpdate")
      .mockImplementation((async (data: {
        props: DatabaseCommonInteractionProps;
      }) => {
        auditUpdates.push({ props: data.props });
      }) as never);
    jest
      .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
      .mockImplementation((async (data: {
        feedInfoInMarkdown: string;
        userId?: ObjectID;
      }) => {
        feed.push({ markdown: data.feedInfoInMarkdown, userId: data.userId });
      }) as never);
    jest.spyOn(Queue, "addJob").mockImplementation((async (
      _queue: unknown,
      _jobId: unknown,
      jobName: string,
    ) => {
      queued.push(jobName);
    }) as never);
    jest
      .spyOn(WorkspaceNotificationLogService, "logButtonPressed")
      .mockResolvedValue(undefined as never);
    // Security Events is on, on this server.
    jest.spyOn(WorkspaceProductRefusal, "getRefusal").mockResolvedValue(null);

    // ---- Every copy of the message, kept and edited ----
    jest
      .spyOn(WorkspaceLiveMessageService, "findByMessageKey")
      .mockImplementation((async () => {
        return keptCopies;
      }) as never);
    jest
      .spyOn(WorkspaceLiveMessageService, "updateOneById")
      .mockResolvedValue(undefined as never);
    // No shared lock in a test: the local hold orders the edits.
    jest
      .spyOn(Semaphore, "lock")
      .mockRejectedValue(new Error("no Valkey in this test"));

    // ---- Slack: every request recorded, and answered as Slack would ----
    jest.spyOn(API, "post").mockImplementation((async (options: {
      url: URL;
      data: JSONObject;
    }) => {
      slackCalls.push({ url: options.url.toString(), data: options.data });
      return new HTTPResponse<JSONObject>(200, { ok: true }, {});
    }) as never);
  });

  afterEach(async () => {
    await WorkspaceSecurityPlaybookApprovalMessages.settle();
    jest.restoreAllMocks();
  });

  test("Approve: approved as the member, on the timeline from Slack and in the audit log, the run queued, and every copy says who approved", async () => {
    const answer: RouteAnswer = await post(
      app.port,
      signed({
        fields: buttonPress({
          actionId: "ApproveSecurityPlaybookStep",
          value: roundValue(),
        }),
      }),
    );

    expect(answer.status).toBe(200);

    await WorkspaceSecurityPlaybookApprovalMessages.settle();

    // The decision, made once, as Simon, keeping every proposed target.
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!["status"]).toBe(SecurityPlaybookRunStatus.Queued);
    const result: SecurityPlaybookStepResult = (
      decisions[0]!["stepResults"] as unknown as Array<SecurityPlaybookStepResult>
    )[0]!;
    expect(result.approval).toMatchObject({
      decision: SecurityPlaybookApprovalDecision.Approved,
      decidedByUserId: SIMON.toString(),
      targets: ["alice@acme.com", "bob@acme.com"],
    });

    // Recorded as Simon: the audit log, and the timeline - which says from Slack.
    expect(auditUpdates).toHaveLength(1);
    expect(auditUpdates[0]!.props.userId?.toString()).toBe(SIMON.toString());
    expect(feed).toHaveLength(1);
    expect(feed[0]!.userId?.toString()).toBe(SIMON.toString());
    expect(feed[0]!.markdown).toBe(
      "👍 Approved step 1 (Suspend the user in Okta) of playbook **Contain account takeover** for `alice@acme.com`, `bob@acme.com`, from Slack.",
    );

    // The run goes on: containment through the playbook engine.
    expect(queued).toEqual(["SecurityPlaybooks:RunPlaybook"]);

    // Told only them, where they pressed.
    expect(answers()).toEqual(["You approved it. The step is running now, and this message shows how it goes."]);

    // Both copies say who approved, and offer nothing to press but Open Case.
    expect(
      edits().map((call: SlackCall): string => {
        return String(call.data["channel"]);
      }),
    ).toEqual([SOC_CHANNEL_ID, SIMON_DM_CHANNEL_ID]);

    for (const edit of edits()) {
      const blocks: string = JSON.stringify(edit.data["blocks"]);

      expect(blocks).toContain("Approved by Simon Lee");
      expect(blocks).toContain("Running now.");
      expect(blocks).not.toContain("ApproveSecurityPlaybookStep");
      expect(blocks).not.toContain("RejectSecurityPlaybookStep");
      expect(blocks).toContain("Open Case");
    }
  });

  test("Reject: the run ends, on the timeline from Slack, and every copy says who rejected it", async () => {
    await post(
      app.port,
      signed({
        fields: buttonPress({
          actionId: "RejectSecurityPlaybookStep",
          value: roundValue(),
        }),
      }),
    );

    await WorkspaceSecurityPlaybookApprovalMessages.settle();

    expect(decisions).toHaveLength(1);
    expect(decisions[0]!["status"]).toBe(SecurityPlaybookRunStatus.Cancelled);
    expect(feed[0]!.markdown).toBe(
      "👎 Rejected step 1 (Suspend the user in Okta) of playbook **Contain account takeover**, from Slack, which ends the run.",
    );
    expect(queued).toEqual([]);
    expect(answers()).toEqual(["You rejected it. The run has ended, and nothing was done."]);
    expect(edits()).toHaveLength(2);

    for (const edit of edits()) {
      expect(JSON.stringify(edit.data["blocks"])).toContain(
        "Rejected by Simon Lee",
      );
    }
  });

  test("Approve Some…: the press opens a form of the targets, and its submission approves only the ones left ticked", async () => {
    await post(
      app.port,
      signed({
        fields: buttonPress({
          actionId: "ViewApproveSomeSecurityPlaybookStep",
          value: roundValue(),
        }),
      }),
    );

    const opened: SlackCall | undefined = slackCalls.find(
      (call: SlackCall): boolean => {
        return call.url === "https://slack.com/api/views.open";
      },
    );

    expect(opened).toBeDefined();
    expect(decisions).toEqual([]);

    const view: JSONObject = opened!.data["view"] as JSONObject;
    const viewJson: string = JSON.stringify(view);

    expect(viewJson).toContain("alice@acme.com: the case is grouped on it");
    expect(viewJson).toContain("bob@acme.com: known to threat intel");
    // The protected one is never offered.
    expect(viewJson).not.toContain("ceo@acme.com");

    await post(
      app.port,
      signed({
        fields: formSubmission({
          privateMetadata: String(view["private_metadata"]),
          fields: ["approveTarget0", "approveTarget1"],
          ticked: ["approveTarget1"],
        }),
      }),
    );

    await WorkspaceSecurityPlaybookApprovalMessages.settle();

    expect(decisions).toHaveLength(1);
    const result: SecurityPlaybookStepResult = (
      decisions[0]!["stepResults"] as unknown as Array<SecurityPlaybookStepResult>
    )[0]!;
    expect(result.approval?.targets).toEqual(["bob@acme.com"]);
    expect(
      result.targets!.map((target: { value: string; state: string }) => {
        return [target.value, target.state];
      }),
    ).toEqual([
      ["alice@acme.com", SecurityPlaybookTargetState.LeftOut],
      ["bob@acme.com", SecurityPlaybookTargetState.Proposed],
      ["ceo@acme.com", SecurityPlaybookTargetState.Protected],
    ]);
    expect(feed[0]!.markdown).toContain("leaving out `alice@acme.com`");
  });

  test("Approve Some… with every box unticked decides nothing", async () => {
    await post(
      app.port,
      signed({
        fields: buttonPress({
          actionId: "ViewApproveSomeSecurityPlaybookStep",
          value: roundValue(),
        }),
      }),
    );

    const view: JSONObject = slackCalls.find((call: SlackCall): boolean => {
      return call.url === "https://slack.com/api/views.open";
    })!.data["view"] as JSONObject;

    await post(
      app.port,
      signed({
        fields: formSubmission({
          privateMetadata: String(view["private_metadata"]),
          fields: ["approveTarget0", "approveTarget1"],
          ticked: [],
        }),
      }),
    );

    expect(decisions).toEqual([]);
  });

  test("a forged request - signed with another secret - is refused before anything is read", async () => {
    const answer: RouteAnswer = await post(
      app.port,
      signed({
        fields: buttonPress({
          actionId: "ApproveSecurityPlaybookStep",
          value: roundValue(),
        }),
        secret: "not-the-app-secret",
      }),
    );

    expect(answer.status).toBe(400);
    expect(answer.text).toContain("Slack Signature Verification Failed.");
    expect(reads).toBe(0);
    expect(decisions).toEqual([]);
    expect(slackCalls).toEqual([]);
  });

  test("a stale request - signed more than five minutes ago - is refused", async () => {
    const answer: RouteAnswer = await post(
      app.port,
      signed({
        fields: buttonPress({
          actionId: "ApproveSecurityPlaybookStep",
          value: roundValue(),
        }),
        timestamp: Math.floor(Date.now() / 1000) - 6 * 60,
      }),
    );

    expect(answer.status).toBe(400);
    expect(decisions).toEqual([]);
  });

  test("a replayed request - the same signed delivery again - is acknowledged and never acted on again", async () => {
    const request: SignedRequest = signed({
      fields: buttonPress({
        actionId: "ApproveSecurityPlaybookStep",
        value: roundValue(),
      }),
    });

    expect((await post(app.port, request)).status).toBe(200);
    expect((await post(app.port, request)).status).toBe(200);

    await WorkspaceSecurityPlaybookApprovalMessages.settle();

    expect(decisions).toHaveLength(1);
    expect(answers()).toEqual(["You approved it. The step is running now, and this message shows how it goes."]);
  });

  test("a second tap, once approved, is told who approved and when, and decides nothing more", async () => {
    await post(
      app.port,
      signed({
        fields: buttonPress({
          actionId: "ApproveSecurityPlaybookStep",
          value: roundValue(),
        }),
      }),
    );
    await post(
      app.port,
      signed({
        fields: buttonPress({
          actionId: "RejectSecurityPlaybookStep",
          value: roundValue(),
        }),
      }),
    );

    expect(decisions).toHaveLength(1);
    expect(answers()).toEqual([
      "You approved it. The step is running now, and this message shows how it goes.",
      expect.stringMatching(/^Already approved by Simon Lee at .+, so nothing more was done\.$/),
    ]);
  });

  test("two taps at once decide once: the second is told the first's", async () => {
    await Promise.all([
      post(
        app.port,
        signed({
          fields: buttonPress({
            actionId: "ApproveSecurityPlaybookStep",
            value: roundValue(),
          }),
        }),
      ),
      post(
        app.port,
        signed({
          fields: buttonPress({
            actionId: "ApproveSecurityPlaybookStep",
            value: roundValue(),
            channelId: SIMON_DM_CHANNEL_ID,
          }),
        }),
      ),
    ]);

    await WorkspaceSecurityPlaybookApprovalMessages.settle();

    expect(decisions).toHaveLength(1);
    expect(answers().sort()).toEqual([
      expect.stringMatching(/^Already approved by Simon Lee at /),
      "You approved it. The step is running now, and this message shows how it goes.",
    ]);
  });

  test("a button value this installation never signed, or another project's, decides nothing and says to open OneUptime", async () => {
    for (const value of [
      "spa1.forged.value",
      WorkspaceSecurityPlaybookApproval.encodeValue({
        projectId: ObjectID.generate(),
        runId: RUN_ID,
        securityCaseId: CASE_ID,
        stepIndex: 0,
        stepId: "contain",
        targetsDigest: "abcdefghijklmnopqrstuv",
      }),
    ]) {
      await post(
        app.port,
        signed({
          fields: buttonPress({
            actionId: "ApproveSecurityPlaybookStep",
            value,
          }),
        }),
      );
    }

    expect(decisions).toEqual([]);
    expect(answers()).toEqual([
      "This button does not name an approval OneUptime can check, so nothing was done. Open the case in OneUptime to decide there.",
      "This button does not name an approval OneUptime can check, so nothing was done. Open the case in OneUptime to decide there.",
    ]);
  });

  test("a Slack account with no OneUptime account is asked to connect, and nothing is decided", async () => {
    linkedUser = null;

    await post(
      app.port,
      signed({
        fields: buttonPress({
          actionId: "ApproveSecurityPlaybookStep",
          value: roundValue(),
        }),
      }),
    );

    expect(decisions).toEqual([]);
    expect(answers()).toHaveLength(1);
    expect(answers()[0]).toContain("approve this playbook step");
  });

  test("a member without the run's update permission is refused, only to them, and nothing is decided", async () => {
    memberProps = propsWith([Permission.SecurityViewer]);

    await post(
      app.port,
      signed({
        fields: buttonPress({
          actionId: "ApproveSecurityPlaybookStep",
          value: roundValue(),
        }),
      }),
    );

    expect(decisions).toEqual([]);
    expect(answers()).toEqual([
      "You do not have permission to approve this playbook step. It takes a role that can run security playbooks: Project Owner, Project Admin, Security Admin, Security Member, or a role that can edit playbook runs.",
    ]);
  });

  test("a member no longer in the project is refused, and nothing is decided", async () => {
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockRejectedValue(
        new NotAuthorizedException(
          WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
        ),
      );

    await post(
      app.port,
      signed({
        fields: buttonPress({
          actionId: "ApproveSecurityPlaybookStep",
          value: roundValue(),
        }),
      }),
    );

    expect(decisions).toEqual([]);
    expect(answers()).toEqual([
      WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE,
    ]);
  });

  test("a member who may no longer read the case is refused, and nothing is decided", async () => {
    isCaseReadable = false;

    await post(
      app.port,
      signed({
        fields: buttonPress({
          actionId: "ApproveSecurityPlaybookStep",
          value: roundValue(),
        }),
      }),
    );

    expect(decisions).toEqual([]);
    expect(answers()).toEqual([
      "You do not have permission to approve this playbook step: your access in this project does not include this security case. Ask a Project Admin for access to it.",
    ]);
  });

  test("whoever started the run may not approve it - somebody else must - but may reject it", async () => {
    run.triggeredByUserId = SIMON;

    await post(
      app.port,
      signed({
        fields: buttonPress({
          actionId: "ApproveSecurityPlaybookStep",
          value: roundValue(),
        }),
      }),
    );

    expect(decisions).toEqual([]);
    expect(answers()).toEqual([
      "You started this run, so someone else must approve its steps.",
    ]);

    await post(
      app.port,
      signed({
        fields: buttonPress({
          actionId: "RejectSecurityPlaybookStep",
          value: roundValue(),
        }),
      }),
    );

    expect(decisions).toHaveLength(1);
    expect(decisions[0]!["status"]).toBe(SecurityPlaybookRunStatus.Cancelled);
  });

  test("a step that proposes other targets than the message showed is decided by nobody", async () => {
    const changed: Array<SecurityPlaybookStepResult> = waitingResults();
    changed[0]!.targets!.push({
      type: SecurityEntityType.User,
      value: "mallory@acme.com",
      reason: SecurityPlaybookTargetReason.ThreatIntel,
      state: SecurityPlaybookTargetState.Proposed,
    });
    run.stepResults = changed as never;

    await post(
      app.port,
      signed({
        fields: buttonPress({
          actionId: "ApproveSecurityPlaybookStep",
          value: roundValue(),
        }),
      }),
    );

    expect(decisions).toEqual([]);
    expect(answers()).toEqual([
      "This approval changed after the message was sent, so nothing was done. Open the case in OneUptime to decide there.",
    ]);
  });

  test("a run cancelled since the message was posted says so, and decides nothing", async () => {
    run.status = SecurityPlaybookRunStatus.Cancelled;

    await post(
      app.port,
      signed({
        fields: buttonPress({
          actionId: "ApproveSecurityPlaybookStep",
          value: roundValue(),
        }),
      }),
    );

    expect(decisions).toEqual([]);
    expect(answers()).toEqual([
      "This step no longer waits for approval, so nothing was done. Open the case in OneUptime to see where its run is.",
    ]);
  });
});
