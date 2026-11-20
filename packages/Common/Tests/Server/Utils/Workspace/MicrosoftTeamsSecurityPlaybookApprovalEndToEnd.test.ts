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
import type { AddressInfo } from "net";

/*
 * APPROVING A PLAYBOOK STEP FROM MICROSOFT TEAMS, END TO END, WITH THE BOT
 * FRAMEWORK'S OWN TOKEN CHECKED (#10341).
 *
 * An approval is containment, so every press here is delivered as the Bot
 * Framework delivers it - an activity with a bearer token signed by a key
 * the channel's OpenID metadata publishes - through the REAL stack:
 *
 *   fake Express req -> MicrosoftTeamsUtil.processBotActivity
 *     -> real CloudAdapter, authenticating the token (issuer, audience,
 *        service URL, endorsement, signature, expiry)
 *     -> real TeamsActivityHandler -> the card's button
 *     -> real TurnContext and ConnectorClient -> HTTP -> a fake Bot Connector
 *
 * The adapter is the SDK's ConfigurationBotFrameworkAuthentication, pointed
 * at a local OpenID metadata server and issuer instead of the Bot
 * Framework's: the checks it makes are the SDK's own. A token signed by
 * another key, one that expired, one for another app or another service
 * URL, and none at all, are refused before the press is read. Only the
 * database under the approval is stood in for.
 */

jest.mock("botbuilder", () => {
  return (
    jest.requireActual("../../../Helpers/RealBotbuilder") as {
      loadRealBotbuilder: (fromFile: string) => unknown;
    }
  ).loadRealBotbuilder(__filename);
});

jest.mock("../../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    MicrosoftTeamsAppClientId: "11111111-2222-3333-4444-555555555555",
    MicrosoftTeamsAppClientSecret: "test-secret",
    MicrosoftTeamsAppTenantId: "test-tenant",
  };
});

jest.mock("../../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: (
      jest.requireActual("../../API/WorkspaceOAuthTestHelpers") as {
        createInMemoryGlobalCache: () => unknown;
      }
    ).createInMemoryGlobalCache(),
  };
});

import MicrosoftTeamsUtil, {
  MicrosoftTeamsTenantResolution,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import MicrosoftTeamsAuthAction, {
  MicrosoftTeamsAccountNotLinkedException,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Auth";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceProductRefusal from "../../../../Server/Utils/Workspace/WorkspaceProductRefusal";
import WorkspaceSecurityPlaybookApproval from "../../../../Server/Utils/Workspace/WorkspaceSecurityPlaybookApproval";
import WorkspaceSecurityPlaybookApprovalMessages from "../../../../Server/Utils/Workspace/WorkspaceSecurityPlaybookApprovalMessages";
import SecurityPlaybookApprovalReader from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookApprovalReader";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import Queue from "../../../../Server/Infrastructure/Queue";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import AuditLogService from "../../../../Server/Services/AuditLogService";
import SecurityCaseFeedService from "../../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import SecurityDetectionService from "../../../../Server/Services/SecurityDetectionService";
import SecurityEventConnectionService from "../../../../Server/Services/SecurityEventConnectionService";
import SecurityPlaybookRunService from "../../../../Server/Services/SecurityPlaybookRunService";
import ThreatIntelIndicatorService from "../../../../Server/Services/ThreatIntelIndicatorService";
import UserService from "../../../../Server/Services/UserService";
import WorkspaceLiveMessageService from "../../../../Server/Services/WorkspaceLiveMessageService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import ProductBrandingText from "../../../../Server/Utils/ProductBrandingText";
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
import Permission, { UserPermission } from "../../../../Types/Permission";
import { SecurityEntityType } from "../../../../Types/SecurityCase/SecurityEntity";
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
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../Server/Utils/Express";
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  ConfigurationServiceClientCredentialFactory,
} from "botbuilder";

const APP_ID: string = "11111111-2222-3333-4444-555555555555";
const ISSUER: string = "https://api.botframework.test";
const KEY_ID: string = "oneuptime-test-key";
const TENANT_ID: string = "5151aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const BOT: JSONObject = { id: "28:oneuptime-bot-app-id", name: "OneUptime" };
const SENDER: JSONObject = {
  id: "29:1simon",
  name: "Simon Lee",
  aadObjectId: "00000000-0000-4000-8000-00000000c1c1",
};
const SENDER_MENTION: string = "<at>Simon Lee</at>";
const PERSONAL_CONVERSATION_ID: string = "a:5151-personal-chat";
const APPROVAL_CARD_ID: string = "approval-card-1";

const PROJECT_ID: ObjectID = new ObjectID(
  "c7000000-0000-4000-8000-000000000001",
);
const SIMON: ObjectID = new ObjectID("c7000000-0000-4000-8000-0000000000a1");
const CASE_ID: ObjectID = new ObjectID("c7000000-0000-4000-8000-0000000000b1");
const RUN_ID: ObjectID = new ObjectID("c7000000-0000-4000-8000-0000000000c1");
const CONNECTION_ID: string = "c7000000-0000-4000-8000-0000000000d1";

const STEPS: Array<SecurityPlaybookStep> = [
  {
    id: "contain",
    action: SecurityPlaybookActionType.ContainCrowdStrikeHost,
    config: { connectionId: CONNECTION_ID },
    requiresApproval: true,
    continueOnFailure: false,
    onlyIfThreatIntelMatched: false,
  },
];

function waitingResults(): Array<SecurityPlaybookStepResult> {
  return [
    {
      stepId: "contain",
      action: SecurityPlaybookActionType.ContainCrowdStrikeHost,
      status: SecurityPlaybookStepStatus.WaitingForApproval,
      targets: [
        {
          type: SecurityEntityType.Host,
          value: "web-01",
          reason: SecurityPlaybookTargetReason.GroupedOn,
          state: SecurityPlaybookTargetState.Proposed,
        },
        {
          type: SecurityEntityType.Host,
          value: "db-02",
          reason: SecurityPlaybookTargetReason.ThreatIntel,
          state: SecurityPlaybookTargetState.Proposed,
        },
      ],
    },
  ];
}

// ---- The keys the channel signs with, published as OpenID metadata ----

interface KeyServer {
  metadataUrl: string;
  close: () => Promise<void>;
}

const signingKey: crypto.KeyPairKeyObjectResult = crypto.generateKeyPairSync(
  "rsa",
  { modulusLength: 2048 },
);
// A key nobody published: what a forger signs with.
const forgingKey: crypto.KeyPairKeyObjectResult = crypto.generateKeyPairSync(
  "rsa",
  { modulusLength: 2048 },
);

async function startKeyServer(): Promise<KeyServer> {
  const jwk: JSONObject = signingKey.publicKey.export({
    format: "jwk",
  }) as unknown as JSONObject;

  const server: http.Server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse) => {
      const address: AddressInfo = server.address() as AddressInfo;
      const base: string = `http://127.0.0.1:${address.port}`;

      if (req.url === "/.well-known/openidconfiguration") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ issuer: ISSUER, jwks_uri: `${base}/keys` }));
        return;
      }

      if (req.url === "/keys") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            keys: [
              {
                kty: "RSA",
                use: "sig",
                kid: KEY_ID,
                n: jwk["n"],
                e: jwk["e"],
                endorsements: ["msteams"],
              },
            ],
          }),
        );
        return;
      }

      res.writeHead(404);
      res.end();
    },
  );

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    metadataUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/.well-known/openidconfiguration`,
    close: async (): Promise<void> => {
      server.closeAllConnections();
      await new Promise<void>((resolve: () => void) => {
        server.close(() => {
          resolve();
        });
      });
    },
  };
}

// A token as the Bot Framework channel signs one: RS256, for the app, for the service URL.
function channelToken(data: {
  serviceUrl: string;
  key?: crypto.KeyObject;
  audience?: string;
  expiresInSeconds?: number;
}): string {
  const now: number = Math.floor(Date.now() / 1000);
  const encode: (value: JSONObject) => string = (value: JSONObject): string => {
    return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  };
  const header: string = encode({ alg: "RS256", typ: "JWT", kid: KEY_ID });
  const payload: string = encode({
    iss: ISSUER,
    aud: data.audience || APP_ID,
    serviceurl: data.serviceUrl,
    iat: now - 30,
    nbf: now - 30,
    exp: now + (data.expiresInSeconds ?? 600),
  });
  const signature: string = crypto
    .sign(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`, "utf8"),
      data.key || signingKey.privateKey,
    )
    .toString("base64url");

  return `${header}.${payload}.${signature}`;
}

// ---- A fake Bot Connector: records what the bot sends ----

const ACTIVITIES_PATH: RegExp =
  /^\/v3\/conversations\/([^/]+)\/activities(?:\/([^/]+))?$/;

interface ConnectorRequest {
  method: string;
  conversationId: string;
  activityId: string | null;
  activity: JSONObject;
}

interface FakeBotConnector {
  serviceUrl: string;
  requests: Array<ConnectorRequest>;
  close: () => Promise<void>;
}

async function startFakeBotConnector(): Promise<FakeBotConnector> {
  let messageNumber: number = 0;

  const fake: FakeBotConnector = {
    serviceUrl: "",
    requests: [],
    close: async (): Promise<void> => {
      return undefined;
    },
  };

  const server: http.Server = http.createServer(
    (req: http.IncomingMessage, res: http.ServerResponse) => {
      let bodyText: string = "";
      req.setEncoding("utf8");
      req.on("data", (chunk: string) => {
        bodyText += chunk;
      });
      req.on("end", () => {
        const path: string = (req.url || "/").split("?")[0] || "/";
        const activities: RegExpExecArray | null = ACTIVITIES_PATH.exec(path);

        if (activities) {
          messageNumber++;
          fake.requests.push({
            method: req.method || "",
            conversationId: decodeURIComponent(activities[1] || ""),
            activityId: activities[2]
              ? decodeURIComponent(activities[2])
              : null,
            activity: bodyText ? (JSON.parse(bodyText) as JSONObject) : {},
          });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: `msg-${messageNumber}` }));
          return;
        }

        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "NotFound" } }));
      });
    },
  );

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  fake.serviceUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  fake.close = async (): Promise<void> => {
    server.closeAllConnections();
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  };

  return fake;
}

class RecordingResponse {
  public statusCode: number | null = null;
  public body: unknown = undefined;
  public headersSent: boolean = false;

  public status(code: number): this {
    this.statusCode = code;
    return this;
  }

  public send(body?: unknown): this {
    this.body = body;
    this.headersSent = true;
    return this;
  }

  public json(body?: unknown): this {
    this.body = body;
    this.headersSent = true;
    return this;
  }

  public end(): this {
    this.headersSent = true;
    return this;
  }

  public header(): this {
    return this;
  }

  public setHeader(): this {
    return this;
  }
}

type CachedAdapterSlot = { cachedAdapter: CloudAdapter | null };

// The member's props, with the permissions of their role in the project.
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

let keys: KeyServer;
let connector: FakeBotConnector;
let activityCounter: number = 0;
let run: SecurityPlaybookRun;
let memberProps: DatabaseCommonInteractionProps;
let decisions: Array<JSONObject>;
let feed: Array<{ markdown: string; userId?: ObjectID | undefined }>;
let auditUpdates: number;
let queued: Array<string>;
let edits: Array<{ location: JSONObject; text: string; blocks: string }>;
let reads: number;

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

// A button of the approval's card pressed, in the approver's personal chat.
function press(
  action: string,
  fields: JSONObject = {},
  replyToId: string = APPROVAL_CARD_ID,
): JSONObject {
  activityCounter++;

  return {
    type: "message",
    id: `5151-press-${activityCounter}-${ObjectID.generate().toString().substring(0, 8)}`,
    timestamp: new Date().toISOString(),
    serviceUrl: connector.serviceUrl,
    channelId: "msteams",
    from: SENDER,
    conversation: {
      conversationType: "personal",
      tenantId: TENANT_ID,
      id: PERSONAL_CONVERSATION_ID,
    },
    recipient: BOT,
    textFormat: "plain",
    locale: "en-US",
    text: "",
    entities: [],
    replyToId: replyToId,
    value: { action, actionValue: roundValue(), ...fields },
    channelData: { tenant: { id: TENANT_ID } },
  };
}

interface Delivery {
  httpStatus: number | null;
  requests: Array<ConnectorRequest>;
}

async function deliver(
  activity: JSONObject,
  authorization: string | null,
): Promise<Delivery> {
  const first: number = connector.requests.length;
  const res: RecordingResponse = new RecordingResponse();

  await MicrosoftTeamsUtil.processBotActivity(
    {
      method: "POST",
      headers: authorization ? { authorization } : {},
      body: JSON.parse(JSON.stringify(activity)),
    } as unknown as ExpressRequest,
    res as unknown as ExpressResponse,
  );

  await WorkspaceSecurityPlaybookApprovalMessages.settle();

  return {
    httpStatus: res.statusCode,
    requests: connector.requests.slice(first),
  };
}

// A press signed as the channel signs one.
async function deliverSigned(activity: JSONObject): Promise<Delivery> {
  return await deliver(
    activity,
    `Bearer ${channelToken({ serviceUrl: connector.serviceUrl })}`,
  );
}

function cardOf(request: ConnectorRequest | undefined): JSONObject {
  const attachment: JSONObject | undefined = (
    request?.activity["attachments"] as Array<JSONObject> | undefined
  )?.[0];

  expect(attachment?.["contentType"]).toBe(
    "application/vnd.microsoft.card.adaptive",
  );

  return attachment!["content"] as JSONObject;
}

// What the bot answered, after the mention of who pressed.
function answersOf(delivery: Delivery): Array<string> {
  return delivery.requests
    .filter((request: ConnectorRequest): boolean => {
      return request.method === "POST" && request.activity["type"] !== "typing";
    })
    .map((request: ConnectorRequest): string => {
      const text: string = String(
        ((cardOf(request)["body"] as Array<JSONObject>)[0] as JSONObject)[
          "text"
        ],
      );

      return text.startsWith(`${SENDER_MENTION} `)
        ? text.substring(SENDER_MENTION.length + 1)
        : text;
    });
}

beforeAll(async () => {
  keys = await startKeyServer();
  connector = await startFakeBotConnector();
});

afterAll(async () => {
  await connector.close();
  await keys.close();
});

beforeEach(() => {
  connector.requests.splice(0);
  memberProps = propsWith([Permission.SecurityMember]);
  decisions = [];
  feed = [];
  auditUpdates = 0;
  queued = [];
  edits = [];
  reads = 0;

  (
    jest.requireMock("../../../../Server/Infrastructure/GlobalCache") as {
      default: { store: Map<string, unknown> };
    }
  ).default.store.clear();

  /*
   * The bot's adapter, as production builds it (ConfigurationBotFrameworkAuthentication
   * for the app), but trusting the local OpenID metadata and issuer above,
   * and sending its replies without a token of its own.
   */
  (MicrosoftTeamsUtil as unknown as CachedAdapterSlot).cachedAdapter =
    new CloudAdapter(
      new ConfigurationBotFrameworkAuthentication(
        {
          MicrosoftAppId: APP_ID,
          MicrosoftAppTenantId: "test-tenant",
          ToBotFromChannelOpenIdMetadataUrl: keys.metadataUrl,
          ToBotFromChannelTokenIssuer: ISSUER,
          ToBotFromEmulatorOpenIdMetadataUrl: keys.metadataUrl,
          ToChannelFromBotLoginUrl:
            "https://login.botframework.test/test-tenant",
          ToChannelFromBotOAuthScope: "https://api.botframework.test",
          OAuthUrl: "https://token.botframework.test",
          CallerId: "urn:botframework:azure",
          ValidateAuthority: false,
        },
        {
          isValidAppId: async (appId: string): Promise<boolean> => {
            return appId === APP_ID;
          },
          isAuthenticationDisabled: async (): Promise<boolean> => {
            return false;
          },
          createCredentials: async (): Promise<unknown> => {
            return {
              signRequest: async (webResource: unknown): Promise<unknown> => {
                return webResource;
              },
            };
          },
        } as never,
      ),
    );

  jest.spyOn(MicrosoftTeamsUtil, "resolveProjectByTenantId").mockResolvedValue({
    projectAuth: {
      projectId: PROJECT_ID,
    } as unknown as WorkspaceProjectAuthToken,
    isAmbiguous: false,
    candidateProjectIds: [PROJECT_ID],
  } as MicrosoftTeamsTenantResolution);
  jest
    .spyOn(
      MicrosoftTeamsUtil as unknown as {
        captureChatFromBotActivity: () => Promise<void>;
      },
      "captureChatFromBotActivity",
    )
    .mockResolvedValue(undefined);
  jest
    .spyOn(MicrosoftTeamsUtil, "captureTeamFromBotActivity")
    .mockResolvedValue(undefined);
  jest
    .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
    .mockResolvedValue(SIMON);
  jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockImplementation(async () => {
      return memberProps;
    });
  jest.spyOn(WorkspaceProductRefusal, "getRefusal").mockResolvedValue(null);

  run = new SecurityPlaybookRun();
  run._id = RUN_ID.toString();
  run.projectId = PROJECT_ID;
  run.securityCaseId = CASE_ID;
  run.playbookName = "Contain compromised host";
  run.status = SecurityPlaybookRunStatus.WaitingForApproval;
  run.trigger = SecurityPlaybookTrigger.DetectionAdded;
  run.steps = STEPS as never;
  run.stepResults = waitingResults() as never;
  run.currentStepIndex = 0;

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
  jest.spyOn(SecurityCaseService, "findOneBy").mockImplementation((async () => {
    const securityCase: SecurityCase = new SecurityCase();
    securityCase._id = CASE_ID.toString();
    securityCase.caseNumberWithPrefix = "SEC-7";
    securityCase.title = "Ransomware staging on web-01";
    securityCase.entities = [] as never;
    return securityCase;
  }) as never);
  jest
    .spyOn(SecurityEventConnectionService, "findOneBy")
    .mockImplementation((async () => {
      const connection: SecurityEventConnection = new SecurityEventConnection();
      connection.name = "CrowdStrike (prod)";
      return connection;
    }) as never);
  jest.spyOn(SecurityDetectionService, "findBy").mockResolvedValue([] as never);
  jest
    .spyOn(ThreatIntelIndicatorService, "findActiveIndicatorsByValues")
    .mockResolvedValue([] as never);
  jest.spyOn(UserService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
  }) => {
    const user: User = new User();
    user.id = data.id;
    user.name = new Name("Simon Lee");
    return user;
  }) as never);
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockResolvedValue(URL.fromString("https://oneuptime.test/dashboard"));
  jest
    .spyOn(ProductBrandingText, "getProductName")
    .mockReturnValue("OneUptime");
  jest.spyOn(AuditLogService, "recordUpdate").mockImplementation((async () => {
    auditUpdates++;
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

  // The approval's card in Simon's personal chat, kept as it was sent.
  jest
    .spyOn(WorkspaceLiveMessageService, "findByMessageKey")
    .mockImplementation((async () => {
      const kept: WorkspaceLiveMessage = new WorkspaceLiveMessage();
      kept._id = ObjectID.generate().toString();
      kept.projectId = PROJECT_ID;
      kept.workspaceType = WorkspaceType.MicrosoftTeams;
      kept.messageKey = `SecurityPlaybookApproval:${RUN_ID.toString()}:0`;
      kept.destinationType = WorkspaceLiveMessageDestinationType.Chat;
      kept.channelId = PERSONAL_CONVERSATION_ID;
      kept.messageId = APPROVAL_CARD_ID;
      kept.contentHash = "as-sent";
      kept.messageData = {
        language: "en",
        directMessageUserId: SIMON.toString(),
        workspaceProjectId: TENANT_ID,
        serviceUrl: "https://smba.trafficmanager.net/amer/",
      };
      return [kept];
    }) as never);
  jest
    .spyOn(WorkspaceLiveMessageService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuth")
    .mockImplementation((async () => {
      const auth: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
      auth.projectId = PROJECT_ID;
      auth.workspaceType = WorkspaceType.MicrosoftTeams;
      auth.authToken = "teams-token";
      auth.workspaceProjectId = TENANT_ID;
      return auth;
    }) as never);
  // The edit of the card, as the Bot Framework is asked for it.
  jest
    .spyOn(MicrosoftTeamsUtil, "updateMessage")
    .mockImplementation((async (data: {
      location: JSONObject;
      text?: string;
      messageBlocks: Array<unknown>;
    }) => {
      edits.push({
        location: data.location,
        text: data.text || "",
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

describe("the Bot Framework's token, checked by the bot's own adapter", () => {
  test("the bot's own adapter is built for the app, so its authentication is never off", async () => {
    const options: ReturnType<
      typeof MicrosoftTeamsUtil.getBotAuthenticationOptions
    > = MicrosoftTeamsUtil.getBotAuthenticationOptions();

    expect(options.MicrosoftAppId).toBe(APP_ID);
    expect(
      await new ConfigurationServiceClientCredentialFactory(
        options,
      ).isAuthenticationDisabled(),
    ).toBe(false);
  });

  test("a press signed as the channel signs one is read, and decided", async () => {
    const delivery: Delivery = await deliverSigned(
      press("ApproveSecurityPlaybookStep"),
    );

    expect(delivery.httpStatus).toBe(200);
    expect(decisions).toHaveLength(1);
  });

  test.each([
    [
      "no token at all",
      (): string | null => {
        return null;
      },
    ],
    [
      "a token signed with a key the channel never published",
      (): string | null => {
        return `Bearer ${channelToken({ serviceUrl: connector.serviceUrl, key: forgingKey.privateKey })}`;
      },
    ],
    [
      "a token that expired more than five minutes ago (stale)",
      (): string | null => {
        return `Bearer ${channelToken({ serviceUrl: connector.serviceUrl, expiresInSeconds: -6 * 60 })}`;
      },
    ],
    [
      "a token for another app",
      (): string | null => {
        return `Bearer ${channelToken({ serviceUrl: connector.serviceUrl, audience: "99999999-2222-3333-4444-555555555555" })}`;
      },
    ],
    [
      "a token for another service URL",
      (): string | null => {
        return `Bearer ${channelToken({ serviceUrl: "https://evil.example/" })}`;
      },
    ],
  ])(
    "%s is refused before the press is read",
    async (_name: string, authorization: () => string | null) => {
      const delivery: Delivery = await deliver(
        press("ApproveSecurityPlaybookStep"),
        authorization(),
      );

      /*
       * Refused by the SDK's own check: 401 for what it calls unauthorized,
       * 500 for a signature it cannot verify (jsonwebtoken's error is not its
       * AuthenticationError). Either way nothing of the press is read.
       */
      expect([401, 500]).toContain(delivery.httpStatus);
      expect(reads).toBe(0);
      expect(decisions).toEqual([]);
      expect(delivery.requests).toEqual([]);
    },
  );

  test("an activity delivered again - the same activity id - is decided once", async () => {
    const activity: JSONObject = press("ApproveSecurityPlaybookStep");

    await deliverSigned(activity);
    const again: Delivery = await deliverSigned(activity);

    expect(decisions).toHaveLength(1);
    expect(answersOf(again)).toEqual([]);
  });
});

describe("a playbook step's approval, pressed in Microsoft Teams", () => {
  test("Approve: approved as the member, on the timeline from Microsoft Teams, the run queued, and the card says who approved", async () => {
    const delivery: Delivery = await deliverSigned(
      press("ApproveSecurityPlaybookStep"),
    );

    expect(decisions).toHaveLength(1);
    expect(decisions[0]!["status"]).toBe(SecurityPlaybookRunStatus.Queued);
    expect(
      (
        decisions[0]![
          "stepResults"
        ] as unknown as Array<SecurityPlaybookStepResult>
      )[0]!.approval,
    ).toMatchObject({
      decision: SecurityPlaybookApprovalDecision.Approved,
      decidedByUserId: SIMON.toString(),
      targets: ["web-01", "db-02"],
    });
    expect(auditUpdates).toBe(1);
    expect(feed[0]!.userId?.toString()).toBe(SIMON.toString());
    expect(feed[0]!.markdown).toBe(
      "👍 Approved step 1 (Contain the host in CrowdStrike) of playbook **Contain compromised host** for `web-01`, `db-02`, from Microsoft Teams.",
    );
    expect(queued).toEqual(["SecurityPlaybooks:RunPlaybook"]);

    expect(answersOf(delivery)).toEqual([
      "You approved it. The step is running now, and this message shows how it goes.",
    ]);

    // The card in the personal chat, edited where it is, through its own service.
    expect(edits).toHaveLength(1);
    expect(edits[0]!.location).toMatchObject({
      channelId: PERSONAL_CONVERSATION_ID,
      isChat: true,
      serviceUrl: "https://smba.trafficmanager.net/amer/",
    });
    expect(edits[0]!.blocks).toContain("Approved by Simon Lee");
    expect(edits[0]!.blocks).not.toContain("ApproveSecurityPlaybookStep");
  });

  test("Reject: the run ends, from Microsoft Teams", async () => {
    const delivery: Delivery = await deliverSigned(
      press("RejectSecurityPlaybookStep"),
    );

    expect(decisions).toHaveLength(1);
    expect(decisions[0]!["status"]).toBe(SecurityPlaybookRunStatus.Cancelled);
    expect(feed[0]!.markdown).toContain(
      ", from Microsoft Teams, which ends the run.",
    );
    expect(answersOf(delivery)).toEqual([
      "You rejected it. The run has ended, and nothing was done.",
    ]);
    expect(edits[0]!.blocks).toContain("Rejected by Simon Lee");
  });

  test("Approve Some…: a card of the targets to untick, whose Approve approves the ones left ticked, then is removed", async () => {
    const opened: Delivery = await deliverSigned(
      press("ViewApproveSomeSecurityPlaybookStep"),
    );

    expect(decisions).toEqual([]);

    const card: JSONObject = cardOf(
      opened.requests.find((request: ConnectorRequest): boolean => {
        return request.method === "POST";
      }),
    );
    const toggles: Array<JSONObject> = (
      card["body"] as Array<JSONObject>
    ).filter((element: JSONObject): boolean => {
      return element["type"] === "Input.Toggle";
    });

    expect(
      toggles.map((toggle: JSONObject): Array<unknown> => {
        return [toggle["id"], toggle["title"], toggle["value"]];
      }),
    ).toEqual([
      ["approveTarget0", "web-01: the case is grouped on it", "true"],
      ["approveTarget1", "db-02: known to threat intel", "true"],
    ]);

    const submit: JSONObject = (card["actions"] as Array<JSONObject>)[0]!;

    expect(submit["title"]).toBe("Approve");
    expect((submit["data"] as JSONObject)["action"]).toBe(
      "SubmitApproveSomeSecurityPlaybookStep",
    );

    const submitted: Delivery = await deliverSigned(
      press(
        "SubmitApproveSomeSecurityPlaybookStep",
        { approveTarget0: "false", approveTarget1: "true" },
        "approve-some-card",
      ),
    );

    expect(decisions).toHaveLength(1);
    expect(
      (
        decisions[0]![
          "stepResults"
        ] as unknown as Array<SecurityPlaybookStepResult>
      )[0]!.approval?.targets,
    ).toEqual(["db-02"]);
    // The form card did its work: removed.
    expect(
      submitted.requests
        .filter((request: ConnectorRequest): boolean => {
          return request.method === "DELETE";
        })
        .map((request: ConnectorRequest): string | null => {
          return request.activityId;
        }),
    ).toEqual(["approve-some-card"]);
  });

  test("a second press, once approved, is told who approved, and decides nothing more", async () => {
    await deliverSigned(press("ApproveSecurityPlaybookStep"));
    const second: Delivery = await deliverSigned(
      press("ApproveSecurityPlaybookStep"),
    );

    expect(decisions).toHaveLength(1);
    expect(answersOf(second)).toEqual([
      expect.stringMatching(
        /^Already approved by Simon Lee at .+, so nothing more was done\.$/,
      ),
    ]);
  });

  test("a Teams account with no OneUptime account is asked to connect, and nothing is decided", async () => {
    jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockRejectedValue(new MicrosoftTeamsAccountNotLinkedException());

    const delivery: Delivery = await deliverSigned(
      press("ApproveSecurityPlaybookStep"),
    );

    expect(decisions).toEqual([]);
    expect(JSON.stringify(delivery.requests)).toContain(
      "approve this playbook step",
    );
  });

  test("a member without the run's update permission is refused, and nothing is decided", async () => {
    memberProps = propsWith([Permission.SecurityViewer]);

    const delivery: Delivery = await deliverSigned(
      press("ApproveSecurityPlaybookStep"),
    );

    expect(decisions).toEqual([]);
    expect(answersOf(delivery)).toEqual([
      "You do not have permission to approve this playbook step. It takes a role that can run security playbooks: Project Owner, Project Admin, Security Admin, Security Member, or a role that can edit playbook runs.",
    ]);
  });

  test("the run's starter may not approve it", async () => {
    run.triggeredByUserId = SIMON;

    const delivery: Delivery = await deliverSigned(
      press("ApproveSecurityPlaybookStep"),
    );

    expect(decisions).toEqual([]);
    expect(answersOf(delivery)).toEqual([
      "You started this run, so someone else must approve its steps.",
    ]);
  });

  test("a card value this bot never signed decides nothing, and says to open OneUptime", async () => {
    const activity: JSONObject = press("ApproveSecurityPlaybookStep");
    (activity["value"] as JSONObject)["actionValue"] = "spa1.forged.value";

    const delivery: Delivery = await deliverSigned(activity);

    expect(decisions).toEqual([]);
    expect(answersOf(delivery)).toEqual([
      "This button does not name an approval OneUptime can check, so nothing was done. Open the case in OneUptime to decide there.",
    ]);
  });
});
