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
import http from "http";
import type { AddressInfo } from "net";

/*
 * `page` TYPED TO THE MICROSOFT TEAMS BOT, END TO END - Slack's
 * `/oneuptime page` (customer feedback #4: "How can we manually trigger a
 * page to someone -- e.g. /oneuptime page @nawaz some-message?").
 *
 * Runs through the REAL botbuilder stack, as MicrosoftTeamsCommandsEndToEnd
 * does (see MicrosoftTeamsCreateCommandsEndToEnd for how the real package
 * gets past Common's moduleNameMapper stub):
 *
 *   fake Express req -> MicrosoftTeamsUtil.processBotActivity
 *     -> real CloudAdapter -> real TeamsActivityHandler
 *     -> handleBotMessageActivity / the card's submit
 *     -> real TurnContext, TeamsInfo.getMember and ConnectorClient
 *     -> HTTP -> a fake Bot Connector on 127.0.0.1
 *
 * and pins what the Bot Connector is sent and asked: who a mention is (the
 * conversation's member, with their Microsoft Entra id and email address),
 * the typing indicator while a page goes out, the Page someone card with
 * what was typed filled in, its submission and its removal, the refusals
 * and the Connect prompt. The page itself (WorkspacePage.page) is stood in
 * for: its own suites run it, and where it is shown.
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

import MicrosoftTeamsUtil, {
  MicrosoftTeamsTenantResolution,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import MicrosoftTeamsAuthAction, {
  MicrosoftTeamsAccountNotLinkedException,
} from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/Auth";
import { MicrosoftTeamsPageActionType } from "../../../../Server/Utils/Workspace/MicrosoftTeams/Actions/ActionTypes";
import MicrosoftTeamsPage from "../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsPage";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceConnectRequest, {
  WorkspaceConnectRequestAgainKind,
  WorkspaceConnectRequestRecord,
} from "../../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import WorkspacePage, {
  WorkspacePageOutcome,
  WorkspacePagePlace,
} from "../../../../Server/Utils/Workspace/WorkspacePage";
import DatabaseConfig from "../../../../Server/DatabaseConfig";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyScheduleService from "../../../../Server/Services/OnCallDutyPolicyScheduleService";
import {
  OnCallPageRecordType,
  OnCallPageTargets,
} from "../../../../Server/Services/OnCallPageService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import UserService from "../../../../Server/Services/UserService";
import WorkspaceUserAuthTokenService from "../../../../Server/Services/WorkspaceUserAuthTokenService";
import WorkspaceUserGroupService from "../../../../Server/Services/WorkspaceUserGroupService";
import logger from "../../../../Server/Utils/Logger";
import ProductBrandingText from "../../../../Server/Utils/ProductBrandingText";
import ProjectMembership from "../../../../Server/Utils/TeamMember/ProjectMembership";
import OnCallDutyPolicySchedule from "../../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import WorkspaceUserGroup from "../../../../Models/DatabaseModels/WorkspaceUserGroup";
import URL from "../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "../../../../Types/Email";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { CONNECT_REQUEST_TOKEN_PATTERN } from "../../../../Types/Workspace/ConnectCallback";
import { WorkspaceLiveMessageDestinationType } from "../../../../Types/Workspace/WorkspaceLiveMessageKey";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../Server/Utils/Express";
import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  TeamsActivityHandler,
} from "botbuilder";

// ---- A fake Bot Connector: records what the bot sends, answers who members are ----

const ACTIVITIES_PATH: RegExp =
  /^\/v3\/conversations\/([^/]+)\/activities(?:\/([^/]+))?$/;
const MEMBER_PATH: RegExp = /^\/v3\/conversations\/([^/]+)\/members\/([^/]+)$/;

interface ConnectorRequest {
  method: string;
  conversationId: string;
  // The activity a reply answers, or a removal removes.
  activityId: string | null;
  activity: JSONObject;
}

interface FakeBotConnector {
  serviceUrl: string;
  requests: Array<ConnectorRequest>;
  // The members of conversations and teams the connector knows, by Teams id.
  members: Record<string, JSONObject>;
  close: () => Promise<void>;
}

async function startFakeBotConnector(): Promise<FakeBotConnector> {
  let messageNumber: number = 0;

  const fake: FakeBotConnector = {
    serviceUrl: "",
    requests: [],
    members: {},
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
        const member: RegExpExecArray | null = MEMBER_PATH.exec(path);

        if (member && req.method === "GET") {
          const memberId: string = decodeURIComponent(member[2] || "");
          const known: JSONObject | undefined = fake.members[memberId];

          fake.requests.push({
            method: "GET member",
            conversationId: decodeURIComponent(member[1] || ""),
            activityId: memberId,
            activity: {},
          });

          if (!known) {
            res.writeHead(404, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                error: { code: "MemberNotFoundInConversation" },
              }),
            );
            return;
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(known));
          return;
        }

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
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
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

// ---- The project behind the bot ----

const TENANT_ID: string = "4221aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const BOT: JSONObject = { id: "28:oneuptime-bot-app-id", name: "OneUptime" };
const SENDER: JSONObject = {
  id: "29:1simon",
  name: "Simon Lee",
  aadObjectId: "00000000-0000-4000-8000-00000000a1a1",
};
const SENDER_MENTION: string = "<at>Simon Lee</at>";
const NAWAZ_IN_TEAMS: JSONObject = {
  id: "29:1nawaz",
  name: "Nawaz Dhandala",
  aadObjectId: "00000000-0000-4000-8000-00000000a2a2",
  email: "nawaz@example.com",
  userPrincipalName: "nawaz@example.com",
};
const ANA_IN_TEAMS: JSONObject = {
  id: "29:1ana",
  name: "Ana Ruiz",
  aadObjectId: "00000000-0000-4000-8000-00000000a3a3",
  email: "Ana@Example.com",
  userPrincipalName: "ana@example.com",
};
const PERSONAL_CONVERSATION_ID: string = "a:4221-personal-chat";
const CHANNEL_CONVERSATION_ID: string =
  "19:ops-4221@thread.tacv2;messageid=1760000000001";
const CHANNEL_ID: string = "19:ops-4221@thread.tacv2";
const TEAM_THREAD_ID: string = "19:ops-team-4221@thread.tacv2";
const GRAPH_TEAM_ID: string = "aaaa4221-0000-4000-8000-000000000001";
const DASHBOARD_URL: string = "https://oneuptime.example.com/dashboard";

const SIMON: ObjectID = new ObjectID("d4000000-0000-4000-8000-0000000000a1");
const NAWAZ: ObjectID = new ObjectID("d4000000-0000-4000-8000-0000000000a2");
const ANA: ObjectID = new ObjectID("d4000000-0000-4000-8000-0000000000a3");
const PRIMARY: ObjectID = new ObjectID("d4000000-0000-4000-8000-0000000000d1");
const ALERT_ID: ObjectID = new ObjectID("d4000000-0000-4000-8000-0000000000b1");

const NAMES: Record<string, string> = {
  [SIMON.toString()]: "Simon Lee",
  [NAWAZ.toString()]: "Nawaz Dhandala",
  [ANA.toString()]: "Ana Ruiz",
};

let connector: FakeBotConnector;
let projectId: ObjectID;
let activityCounter: number = 0;
let pages: Array<{
  targets: OnCallPageTargets;
  message: string;
  place: WorkspacePagePlace | undefined;
  props: DatabaseCommonInteractionProps;
  workspaceType: WorkspaceType;
}>;
let outcome: () => Promise<WorkspacePageOutcome>;
let mayPage: boolean;
// The Microsoft Entra ids connected to OneUptime accounts in the project.
let connected: Record<string, ObjectID>;
// The project's Microsoft Teams tags that follow on-call schedules.
let tags: Array<WorkspaceUserGroup>;

// A tag OneUptime keeps equal to whoever is on call in Primary.
function tagOf(workspaceGroupId: string, name: string): WorkspaceUserGroup {
  const row: WorkspaceUserGroup = new WorkspaceUserGroup();
  row.id = ObjectID.generate();
  row.workspaceType = WorkspaceType.MicrosoftTeams;
  row.workspaceGroupId = workspaceGroupId;
  row.workspaceTeamId = GRAPH_TEAM_ID;
  row.name = name;

  const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
  schedule.id = PRIMARY;
  row.onCallDutyPolicySchedules = [schedule];

  return row;
}

function nextActivityId(label: string): string {
  activityCounter++;
  return `4221-${label}-${activityCounter}-${ObjectID.generate().toString().substring(0, 8)}`;
}

function userOf(id: ObjectID): User {
  const user: User = new User();
  user.id = id;
  user.name = (NAMES[id.toString()] || "") as never;
  user.email = new Email(
    `${(NAMES[id.toString()] || "x").split(" ")[0]!.toLowerCase()}@example.com`,
  );
  return user;
}

/*
 * A message typed to the bot - in a personal chat, or after @OneUptime in a
 * channel - @mentioning `mentioned` where the text writes <at>Name</at>.
 */
function message(
  text: string,
  where: "personal" | "channel" = "personal",
  mentioned: Array<JSONObject> = [],
): JSONObject {
  const inChannel: boolean = where === "channel";
  const mentionEntities: Array<JSONObject> = mentioned.map(
    (person: JSONObject): JSONObject => {
      return {
        type: "mention",
        text: `<at>${String(person["name"])}</at>`,
        mentioned: { id: person["id"], name: person["name"] },
      };
    },
  );

  return {
    type: "message",
    id: nextActivityId(where),
    timestamp: "2026-10-14T10:00:00.000Z",
    serviceUrl: connector.serviceUrl,
    channelId: "msteams",
    from: SENDER,
    conversation: inChannel
      ? {
          conversationType: "channel",
          tenantId: TENANT_ID,
          id: CHANNEL_CONVERSATION_ID,
          isGroup: true,
        }
      : {
          conversationType: "personal",
          tenantId: TENANT_ID,
          id: PERSONAL_CONVERSATION_ID,
        },
    recipient: BOT,
    textFormat: "plain",
    locale: "en-US",
    text: inChannel ? `<at>OneUptime</at> ${text}` : text,
    entities: inChannel
      ? [
          { type: "mention", text: "<at>OneUptime</at>", mentioned: BOT },
          ...mentionEntities,
        ]
      : mentionEntities,
    channelData: inChannel
      ? {
          tenant: { id: TENANT_ID },
          team: {
            id: TEAM_THREAD_ID,
            name: "Operations",
            aadGroupId: GRAPH_TEAM_ID,
          },
          channel: { id: CHANNEL_ID, name: "ops" },
        }
      : { tenant: { id: TENANT_ID } },
  };
}

// The Page someone card, submitted: a message whose value names the action.
function submission(
  value: JSONObject,
  where: "personal" | "channel" = "personal",
): JSONObject {
  const activity: JSONObject = message("", where);
  activity["text"] = "";
  activity["entities"] = [];
  activity["replyToId"] = "form-card-1";
  activity["value"] = {
    action: MicrosoftTeamsPageActionType.SubmitPageSomeone,
    ...value,
  };
  return activity;
}

interface Delivery {
  httpStatus: number | null;
  requests: Array<ConnectorRequest>;
}

async function deliver(activity: JSONObject): Promise<Delivery> {
  const first: number = connector.requests.length;
  const res: RecordingResponse = new RecordingResponse();

  await MicrosoftTeamsUtil.processBotActivity(
    {
      method: "POST",
      headers: {},
      body: JSON.parse(JSON.stringify(activity)),
    } as unknown as ExpressRequest,
    res as unknown as ExpressResponse,
  );

  return {
    httpStatus: res.statusCode,
    requests: connector.requests.slice(first),
  };
}

// What the bot sent to the conversation: replies and posts, typing included.
function sent(delivery: Delivery): Array<ConnectorRequest> {
  return delivery.requests.filter((request: ConnectorRequest): boolean => {
    return request.method === "POST";
  });
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

// An answer card (MicrosoftTeamsActionAnswer): what it says after the mention.
function answerOf(request: ConnectorRequest | undefined): string {
  const card: JSONObject = cardOf(request);
  const text: string = String(
    ((card["body"] as Array<JSONObject>)[0] as JSONObject)["text"],
  );

  expect(text.startsWith(`${SENDER_MENTION} `)).toBe(true);

  return text.substring(SENDER_MENTION.length + 1);
}

function elementOf(card: JSONObject, id: string): JSONObject | undefined {
  return (card["body"] as Array<JSONObject>).find(
    (element: JSONObject): boolean => {
      return element["id"] === id;
    },
  );
}

// ---- Lifecycle ----

const keptConnectRequests: Map<string, string> = new Map<string, string>();

beforeAll(async () => {
  connector = await startFakeBotConnector();
});

afterAll(async () => {
  await connector.close();
});

beforeEach(() => {
  connector.requests.splice(0);
  connector.members = {
    [String(NAWAZ_IN_TEAMS["id"])]: NAWAZ_IN_TEAMS,
    [String(ANA_IN_TEAMS["id"])]: ANA_IN_TEAMS,
  };
  projectId = ObjectID.generate();
  pages = [];
  mayPage = true;
  connected = { [String(NAWAZ_IN_TEAMS["aadObjectId"])]: NAWAZ };
  outcome = async (): Promise<WorkspacePageOutcome> => {
    return {
      result: {
        record: {
          type: OnCallPageRecordType.Alert,
          id: ALERT_ID,
          label: "Alert AL-12",
          title: "db down",
          url: URL.fromString(`${DASHBOARD_URL}/alerts`),
          isNew: true,
        },
        paged: [],
        startedPolicies: [],
        notPaged: [],
        isAnyonePaged: true,
        directPageExecutionLogId: ObjectID.generate(),
        summary: "",
      },
      isShownAtPlace: true,
      answer: null,
    };
  };

  (MicrosoftTeamsUtil as unknown as CachedAdapterSlot).cachedAdapter =
    new CloudAdapter(new ConfigurationBotFrameworkAuthentication({}));

  jest.spyOn(MicrosoftTeamsUtil, "resolveProjectByTenantId").mockResolvedValue({
    projectAuth: {
      projectId: projectId,
    } as unknown as WorkspaceProjectAuthToken,
    isAmbiguous: false,
    candidateProjectIds: [projectId],
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

  // Simon has a connected account and is a member.
  jest
    .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
    .mockResolvedValue(SIMON);
  jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockImplementation(async () => {
      return {
        userId: SIMON,
        tenantId: projectId,
      } as DatabaseCommonInteractionProps;
    });
  jest
    .spyOn(WorkspaceActionAuthorization, "assertCanCreate")
    .mockImplementation(
      async (data: { modelType: unknown; action: string }) => {
        if (!mayPage && data.modelType === OnCallDutyPolicyExecutionLog) {
          throw new NotAuthorizedException(
            `You do not have permission to ${data.action}. You need one of these permissions: Project Member.`,
          );
        }
      },
    );

  // Who is who, and who is a member.
  jest
    .spyOn(WorkspaceUserAuthTokenService, "findBy")
    .mockImplementation((async () => {
      return Object.keys(connected).map(
        (aadObjectId: string): WorkspaceUserAuthToken => {
          const token: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
          token.workspaceUserId = aadObjectId;
          token.userId = connected[aadObjectId]!;
          return token;
        },
      );
    }) as never);
  jest.spyOn(UserService, "findBy").mockImplementation((async (data: {
    query: { email?: unknown };
  }) => {
    const everybody: Array<User> = [SIMON, NAWAZ, ANA].map(userOf);

    if (data.query.email) {
      return everybody.filter((user: User): boolean => {
        return JSON.stringify(data.query.email).includes(
          `"${user.email!.toString()}"`,
        );
      });
    }

    return everybody;
  }) as never);
  jest
    .spyOn(ProjectMembership, "getMemberUserIds")
    .mockImplementation(async () => {
      return new Set<string>(
        [SIMON, NAWAZ, ANA].map((id: ObjectID): string => {
          return id.toString().toLowerCase();
        }),
      );
    });

  // What the card offers: a schedule, and the people.
  tags = [tagOf("tag-payments", "Payments on-call")];

  jest
    .spyOn(WorkspaceActionAuthorization, "findReadable")
    .mockImplementation((async (data: { service: unknown }) => {
      if (data.service === WorkspaceUserGroupService) {
        return tags;
      }

      if (data.service === OnCallDutyPolicyScheduleService) {
        const schedule: OnCallDutyPolicySchedule =
          new OnCallDutyPolicySchedule();
        schedule.id = PRIMARY;
        schedule.name = "Primary";
        schedule.currentUserOnRoster = userOf(NAWAZ);
        return [schedule];
      }

      if (data.service === TeamMemberService) {
        return [SIMON, NAWAZ].map((id: ObjectID): TeamMember => {
          const member: TeamMember = new TeamMember();
          member.userId = id;
          member.user = userOf(id);
          return member;
        });
      }

      return [];
    }) as never);

  jest
    .spyOn(WorkspacePage, "page")
    .mockImplementation(
      async (data: Parameters<typeof WorkspacePage.page>[0]) => {
        pages.push({
          targets: data.targets,
          message: data.message,
          place: data.place,
          props: data.props,
          workspaceType: data.workspaceType,
        });
        return await outcome();
      },
    );

  jest.spyOn(DatabaseConfig, "getDashboardUrl").mockImplementation(() => {
    return Promise.resolve(URL.fromString(DASHBOARD_URL));
  });
  jest
    .spyOn(ProductBrandingText, "getProductName")
    .mockReturnValue("OneUptime");

  keptConnectRequests.clear();
  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        keptConnectRequests.set(`${namespace}:${key}`, value);
      },
    );
  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(async (namespace: string, key: string) => {
      return keptConnectRequests.get(`${namespace}:${key}`) ?? null;
    });

  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined;
  });
  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  (MicrosoftTeamsUtil as unknown as CachedAdapterSlot).cachedAdapter = null;
  jest.restoreAllMocks();
});

// ---- Tests ----

describe("harness: the real botbuilder stack", () => {
  test("botbuilder is the real package, not Common's stub", () => {
    expect(typeof CloudAdapter.prototype.process).toBe("function");
    expect(typeof TeamsActivityHandler.prototype.run).toBe("function");
  });
});

describe("page @Nawaz <message>: paged at once", () => {
  test("in a personal chat: the bot shows it is on it, then the page - Nawaz, the message, shown in this chat", async () => {
    const delivery: Delivery = await deliver(
      message(
        "page <at>Nawaz Dhandala</at> The checkout API is down",
        "personal",
        [NAWAZ_IN_TEAMS],
      ),
    );

    expect(delivery.httpStatus).toBe(200);

    // Who the mention is: asked of the conversation's members.
    expect(
      delivery.requests.filter((request: ConnectorRequest): boolean => {
        return request.method === "GET member";
      }),
    ).toEqual([
      {
        method: "GET member",
        conversationId: PERSONAL_CONVERSATION_ID,
        activityId: "29:1nawaz",
        activity: {},
      },
    ]);

    // Typing, and nothing else: the page's card is the confirmation.
    expect(
      sent(delivery).map((request: ConnectorRequest): unknown => {
        return request.activity["type"];
      }),
    ).toEqual(["typing"]);

    expect(pages).toEqual([
      {
        targets: { userIds: [NAWAZ] },
        message: "The checkout API is down",
        place: {
          workspaceType: WorkspaceType.MicrosoftTeams,
          destinationType: WorkspaceLiveMessageDestinationType.Chat,
          channelId: PERSONAL_CONVERSATION_ID,
        },
        props: { userId: SIMON, tenantId: projectId },
        workspaceType: WorkspaceType.MicrosoftTeams,
      },
    ]);
  });

  test("in a channel: after @OneUptime, the page is shown in the channel, of the team Graph knows it by", async () => {
    await deliver(
      message("page <at>Nawaz Dhandala</at>: db down", "channel", [
        NAWAZ_IN_TEAMS,
      ]),
    );

    expect(pages[0]!.message).toBe("db down");
    expect(pages[0]!.targets).toEqual({ userIds: [NAWAZ] });
    expect(pages[0]!.place).toEqual({
      workspaceType: WorkspaceType.MicrosoftTeams,
      destinationType: WorkspaceLiveMessageDestinationType.Channel,
      channelId: CHANNEL_ID,
      teamId: GRAPH_TEAM_ID,
      channelName: "ops",
    });
    // In a team, who a member is is asked of the team.
    expect(
      connector.requests.find((request: ConnectorRequest): boolean => {
        return request.method === "GET member";
      })!.conversationId,
    ).toBe(TEAM_THREAD_ID);
  });

  test("somebody whose Teams account is not connected is paged by the email address Teams has for them", async () => {
    await deliver(
      message("page <at>Ana Ruiz</at> db down", "personal", [ANA_IN_TEAMS]),
    );

    expect(pages[0]!.targets).toEqual({ userIds: [ANA] });
  });

  test("two people, 'and' between them", async () => {
    await deliver(
      message(
        "page <at>Nawaz Dhandala</at> and <at>Ana Ruiz</at> replica lag",
        "personal",
        [NAWAZ_IN_TEAMS, ANA_IN_TEAMS],
      ),
    );

    expect(pages[0]!.targets).toEqual({ userIds: [NAWAZ, ANA] });
    expect(pages[0]!.message).toBe("replica lag");
  });

  test("&, < and > as Teams writes them read as typed", async () => {
    await deliver(
      message(
        "page <at>Nawaz Dhandala</at> p99 &gt; 2s &amp; errors &lt; 1%",
        "personal",
        [NAWAZ_IN_TEAMS],
      ),
    );

    expect(pages[0]!.message).toBe("p99 > 2s & errors < 1%");
  });

  test("a page the conversation does not show is answered in a reply that mentions Simon", async () => {
    outcome = async (): Promise<WorkspacePageOutcome> => {
      const base: WorkspacePageOutcome = {
        result: undefined as never,
        isShownAtPlace: false,
        answer: {
          markdown:
            "📟 Paged **Nawaz Dhandala** about **Alert AL-12**: “db down”",
          text: "Paged Nawaz Dhandala about Alert AL-12",
        },
      };
      return base;
    };

    const delivery: Delivery = await deliver(
      message("page <at>Nawaz Dhandala</at> db down", "personal", [
        NAWAZ_IN_TEAMS,
      ]),
    );

    const posts: Array<ConnectorRequest> = sent(delivery);

    expect(posts).toHaveLength(2);
    expect(answerOf(posts[1])).toBe(
      "📟 Paged **Nawaz Dhandala** about **Alert AL-12**: “db down”",
    );
    expect(posts[1]!.activity["summary"]).toBe(
      "Paged Nawaz Dhandala about Alert AL-12",
    );
  });

  test("a refusal of the page itself is told in a reply, as 'Could not page'", async () => {
    outcome = async (): Promise<WorkspacePageOutcome> => {
      throw new NotAuthorizedException(
        "Paging people, teams or on-call schedules directly takes access to every on-call policy of the project.",
      );
    };

    const delivery: Delivery = await deliver(
      message("page <at>Nawaz Dhandala</at> db down", "personal", [
        NAWAZ_IN_TEAMS,
      ]),
    );

    expect(delivery.httpStatus).toBe(200);
    expect(answerOf(sent(delivery)[1])).toBe(
      "Could not page: Paging people, teams or on-call schedules directly takes access to every on-call policy of the project.",
    );
  });
});

describe("anything else: the Page someone card, with what was typed filled in", () => {
  test("'page' alone: the card - who to page, each choice led by its kind - and the message", async () => {
    const delivery: Delivery = await deliver(message("page"));

    expect(delivery.httpStatus).toBe(200);
    expect(pages).toEqual([]);

    const posts: Array<ConnectorRequest> = sent(delivery);
    expect(posts).toHaveLength(1);

    const card: JSONObject = cardOf(posts[0]);
    const who: JSONObject = elementOf(card, "pageTargets")!;
    const text: JSONObject = elementOf(card, "pageMessage")!;

    expect((card["body"] as Array<JSONObject>)[0]).toMatchObject({
      type: "TextBlock",
      text: "Page someone",
    });
    expect(who).toMatchObject({
      type: "Input.ChoiceSet",
      label: "Who to page",
      // As Slack's form says it: Teams draws an empty list blank otherwise.
      placeholder: "Pick people, a team or a schedule",
      style: "compact",
      isMultiSelect: true,
      isRequired: true,
      errorMessage: "Pick who to page.",
    });
    expect(who["choices"]).toEqual([
      {
        title: "Schedule · Primary (Nawaz Dhandala on call now)",
        value: `schedule:${PRIMARY.toString()}`,
      },
      { title: "Person · Nawaz Dhandala", value: `user:${NAWAZ.toString()}` },
      { title: "Person · Simon Lee (you)", value: `user:${SIMON.toString()}` },
    ]);
    expect(who["value"]).toBeUndefined();
    expect(text).toMatchObject({
      type: "Input.Text",
      label: "Message",
      placeholder: "What should they look at?",
      isMultiline: true,
      isRequired: true,
      errorMessage: "Write what the page is about.",
    });
    expect(text["value"]).toBeUndefined();

    // Each field's hint right under it, in the subtle small text of a note.
    const body: Array<JSONObject> = card["body"] as Array<JSONObject>;
    const whoAt: number = body.indexOf(who);
    const textAt: number = body.indexOf(text);
    expect(body[whoAt + 1]).toMatchObject({
      type: "TextBlock",
      text: "A schedule pages whoever is on call in it now. A policy pages through its escalation rules.",
      isSubtle: true,
      size: "Small",
    });
    expect(body[textAt + 1]).toMatchObject({
      type: "TextBlock",
      text: "The people you page get this as the title of a new alert.",
      isSubtle: true,
      size: "Small",
    });

    // What the chat list and a notification show of the card.
    expect(posts[0]!.activity["summary"]).toBe("Page someone");
    expect(card["actions"]).toEqual([
      {
        type: "Action.Submit",
        title: "Page",
        style: "positive",
        data: { action: "SubmitPageSomeone" },
      },
    ]);
  });

  test("@Nawaz with no message: Nawaz picked, the message to write", async () => {
    const delivery: Delivery = await deliver(
      message("page <at>Nawaz Dhandala</at>", "personal", [NAWAZ_IN_TEAMS]),
    );
    const card: JSONObject = cardOf(sent(delivery)[0]);

    expect(elementOf(card, "pageTargets")!["value"]).toBe(
      `user:${NAWAZ.toString()}`,
    );
    expect(pages).toEqual([]);
  });

  test("a schedule's name first: picked, the rest the message", async () => {
    const delivery: Delivery = await deliver(
      message("page primary the DB is down", "channel"),
    );
    const card: JSONObject = cardOf(sent(delivery)[0]);

    expect(elementOf(card, "pageTargets")!["value"]).toBe(
      `schedule:${PRIMARY.toString()}`,
    );
    expect(elementOf(card, "pageMessage")!["value"]).toBe("the DB is down");
  });

  test("somebody OneUptime cannot tell - not connected, no email address - is said in a note", async () => {
    connector.members = {};

    const delivery: Delivery = await deliver(
      message("page <at>Nawaz Dhandala</at> db down", "personal", [
        NAWAZ_IN_TEAMS,
      ]),
    );
    const card: JSONObject = cardOf(sent(delivery)[0]);

    /*
     * In the card's own text colour: Teams' light theme draws "Warning"
     * text as yellow (#f8d22a) on white, which cannot be read.
     */
    expect((card["body"] as Array<JSONObject>)[1]).toEqual({
      type: "TextBlock",
      text: "⚠️ OneUptime can't tell who @Nawaz Dhandala is: their Microsoft Teams account isn't connected to OneUptime. Pick them below.",
      wrap: true,
    });
    expect(elementOf(card, "pageMessage")!["value"]).toBe("db down");
    expect(pages).toEqual([]);
  });

  test("a tag @mentioned - not a person - is said in a note", async () => {
    const activity: JSONObject = message(
      "page <at>On-call DBAs</at> db down",
      "personal",
    );
    activity["entities"] = [
      {
        type: "mention",
        text: "<at>On-call DBAs</at>",
        mentioned: { id: "tag-4221", name: "On-call DBAs" },
      },
    ];

    const delivery: Delivery = await deliver(activity);
    const card: JSONObject = cardOf(sent(delivery)[0]);

    expect((card["body"] as Array<JSONObject>)[1]!["text"]).toBe(
      "⚠️ OneUptime can't page @On-call DBAs: it isn't connected to an on-call schedule you can see. Pick the on-call schedule, the team or the people below.",
    );
  });

  test("a tag OneUptime keeps, with no message: the card, its schedule picked - nothing to say", async () => {
    const activity: JSONObject = message(
      "page <at>Payments on-call</at>",
      "channel",
    );
    (activity["entities"] as Array<JSONObject>).push({
      type: "mention",
      text: "<at>Payments on-call</at>",
      mentioned: { id: "tag-payments", name: "Payments on-call", type: "tag" },
    });

    const delivery: Delivery = await deliver(activity);
    const card: JSONObject = cardOf(sent(delivery)[0]);

    expect(elementOf(card, "pageTargets")!["value"]).toBe(
      `schedule:${PRIMARY.toString()}`,
    );
    expect(pages).toEqual([]);
  });
});

describe("page @<a tag that follows on-call schedules> <message>: paged at once", () => {
  function tagMessage(text: string, mentioned: JSONObject): JSONObject {
    const activity: JSONObject = message(text, "channel");
    (activity["entities"] as Array<JSONObject>).push({
      type: "mention",
      text: `<at>${String(mentioned["name"])}</at>`,
      mentioned: mentioned,
    });
    return activity;
  }

  test("the tag Teams mentions: whoever is on call in the schedules it follows is paged, in this channel", async () => {
    const delivery: Delivery = await deliver(
      tagMessage("page <at>Payments on-call</at> The checkout API is down", {
        id: "tag-payments",
        name: "Payments on-call",
        type: "tag",
      }),
    );

    expect(delivery.httpStatus).toBe(200);
    // Typing, and nothing else: the page's card is the confirmation.
    expect(
      sent(delivery).map((request: ConnectorRequest): unknown => {
        return request.activity["type"];
      }),
    ).toEqual(["typing"]);
    expect(pages).toEqual([
      {
        targets: { userIds: [], onCallScheduleIds: [PRIMARY] },
        message: "The checkout API is down",
        place: {
          workspaceType: WorkspaceType.MicrosoftTeams,
          destinationType: WorkspaceLiveMessageDestinationType.Channel,
          channelId: CHANNEL_ID,
          teamId: GRAPH_TEAM_ID,
          channelName: "ops",
        },
        props: { userId: SIMON, tenantId: projectId },
        workspaceType: WorkspaceType.MicrosoftTeams,
      },
    ]);
  });

  test("a tag Teams mentions by an id of its own: the one tag of that name that follows schedules", async () => {
    await deliver(
      tagMessage("page <at>Payments on-call</at> db down", {
        id: "MjQzMmI1N2ItMGFiZC00M2RiLWFhN2ItMTZlYWRkMTE1ZDM0",
        name: "Payments on-call",
        type: "tag",
      }),
    );

    expect(pages[0]!.targets).toEqual({
      userIds: [],
      onCallScheduleIds: [PRIMARY],
    });
  });

  test("a person and a tag: one page, of both", async () => {
    const activity: JSONObject = message(
      "page <at>Nawaz Dhandala</at> <at>Payments on-call</at> db down",
      "channel",
      [NAWAZ_IN_TEAMS],
    );
    (activity["entities"] as Array<JSONObject>).push({
      type: "mention",
      text: "<at>Payments on-call</at>",
      mentioned: { id: "tag-payments", name: "Payments on-call", type: "tag" },
    });

    await deliver(activity);

    expect(pages[0]!.targets).toEqual({
      userIds: [NAWAZ],
      onCallScheduleIds: [PRIMARY],
    });
    expect(pages[0]!.message).toBe("db down");
  });
});

describe("who may page", () => {
  test("a Teams user with no connected account: asked to connect, and to type page again - nobody paged", async () => {
    jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockRejectedValue(
        new MicrosoftTeamsAccountNotLinkedException("not linked"),
      );

    const delivery: Delivery = await deliver(
      message("page <at>Nawaz Dhandala</at> db down", "channel", [
        NAWAZ_IN_TEAMS,
      ]),
    );

    expect(delivery.httpStatus).toBe(200);
    expect(sent(delivery)).toHaveLength(1);
    expect(answerOf(sent(delivery)[0])).toBe(
      "🔗 **Connect your Microsoft Teams account to page someone.** It takes one click. Then type **page** again.",
    );

    const button: JSONObject = (
      cardOf(sent(delivery)[0])["actions"] as Array<JSONObject>
    )[0]!;
    const url: globalThis.URL = new globalThis.URL(String(button["url"]));
    const token: string | null = url.searchParams.get("connect");
    expect(token).toMatch(CONNECT_REQUEST_TOKEN_PATTERN);

    const kept: WorkspaceConnectRequestRecord | null =
      await WorkspaceConnectRequest.peek(token);
    expect(kept).toMatchObject({
      purpose: "page someone",
      again: {
        kind: WorkspaceConnectRequestAgainKind.Command,
        label: "page",
      },
    });
    expect(kept!.pendingAction).toBeUndefined();
    expect(pages).toEqual([]);
  });

  test("somebody who may not page: told which permission it takes, and no card", async () => {
    mayPage = false;

    const delivery: Delivery = await deliver(message("page"));

    expect(sent(delivery)).toHaveLength(1);
    expect(answerOf(sent(delivery)[0])).toBe(
      "You do not have permission to page people. You need one of these permissions: Project Member.",
    );
    expect(pages).toEqual([]);
  });
});

describe("the Page someone card, submitted", () => {
  test("pages everybody picked, with the message - shown where the card is - then the card goes, so it is not sent twice", async () => {
    const delivery: Delivery = await deliver(
      submission({
        pageTargets: `schedule:${PRIMARY.toString()},user:${NAWAZ.toString()}`,
        pageMessage: "The checkout API is down",
      }),
    );

    expect(delivery.httpStatus).toBe(200);
    expect(pages).toEqual([
      {
        targets: {
          userIds: [NAWAZ],
          teamIds: [],
          onCallScheduleIds: [PRIMARY],
          onCallDutyPolicyIds: [],
        },
        message: "The checkout API is down",
        place: {
          workspaceType: WorkspaceType.MicrosoftTeams,
          destinationType: WorkspaceLiveMessageDestinationType.Chat,
          channelId: PERSONAL_CONVERSATION_ID,
        },
        props: { userId: SIMON, tenantId: projectId },
        workspaceType: WorkspaceType.MicrosoftTeams,
      },
    ]);

    // Typing while it pages, then the card's removal.
    expect(
      delivery.requests.map((request: ConnectorRequest): string => {
        return request.method === "DELETE"
          ? `DELETE ${request.activityId}`
          : String(request.activity["type"]);
      }),
    ).toEqual(["typing", "DELETE form-card-1"]);
  });

  test("a card left wrong is answered, and stays to be put right", async () => {
    const delivery: Delivery = await deliver(
      submission({ pageTargets: "", pageMessage: "  " }),
    );

    expect(pages).toEqual([]);
    expect(answerOf(sent(delivery)[0])).toBe(
      "Pick who to page. Write what the page is about.",
    );
    expect(
      delivery.requests.filter((request: ConnectorRequest): boolean => {
        return request.method === "DELETE";
      }),
    ).toEqual([]);
  });

  test("a page refused: told why, and the card stays", async () => {
    outcome = async (): Promise<WorkspacePageOutcome> => {
      throw new NotAuthorizedException("You may not page these people.");
    };

    const delivery: Delivery = await deliver(
      submission({
        pageTargets: `user:${NAWAZ.toString()}`,
        pageMessage: "db down",
      }),
    );

    expect(answerOf(sent(delivery)[1])).toBe(
      "Could not page: You may not page these people.",
    );
    expect(
      delivery.requests.filter((request: ConnectorRequest): boolean => {
        return request.method === "DELETE";
      }),
    ).toEqual([]);
  });

  test("submitted by somebody who may not page: told so, nobody paged, the card stays", async () => {
    mayPage = false;

    const delivery: Delivery = await deliver(
      submission({
        pageTargets: `user:${NAWAZ.toString()}`,
        pageMessage: "db down",
      }),
    );

    expect(pages).toEqual([]);
    expect(answerOf(sent(delivery)[0])).toBe(
      "You do not have permission to page people. You need one of these permissions: Project Member.",
    );
  });

  test("submitted by somebody with no connected account: asked to connect, and to type page again", async () => {
    jest
      .spyOn(MicrosoftTeamsAuthAction, "getOneUptimeUserIdFromTeamsUserId")
      .mockRejectedValue(
        new MicrosoftTeamsAccountNotLinkedException("not linked"),
      );

    const delivery: Delivery = await deliver(
      submission({
        pageTargets: `user:${NAWAZ.toString()}`,
        pageMessage: "db down",
      }),
    );

    expect(answerOf(sent(delivery)[0])).toBe(
      "🔗 **Connect your Microsoft Teams account to page someone.** It takes one click. Then type **page** again.",
    );
    expect(pages).toEqual([]);
  });
});

describe("MicrosoftTeamsPage.getPageTokens: a message, read", () => {
  test("the bot's mention goes, people are people, a tag is a group, and the first word - page - goes", () => {
    expect(
      MicrosoftTeamsPage.getPageTokens({
        text: "<at>OneUptime</at> Page <at>Nawaz Dhandala</at>, <at>DBAs</at>: db",
        recipient: { id: "28:bot" },
        entities: [
          {
            type: "mention",
            text: "<at>OneUptime</at>",
            mentioned: { id: "28:bot", name: "OneUptime" },
          },
          {
            type: "mention",
            text: "<at>Nawaz Dhandala</at>",
            mentioned: { id: "29:1nawaz", name: "Nawaz Dhandala" },
          },
          {
            type: "mention",
            text: "<at>DBAs</at>",
            mentioned: { id: "tag-1", name: "DBAs" },
          },
        ],
      }),
    ).toEqual([
      { kind: "text", text: " " },
      {
        kind: "person",
        person: { workspaceUserId: "29:1nawaz", name: "Nawaz Dhandala" },
      },
      { kind: "text", text: ", " },
      // With the id Teams mentioned it by: what a tag is matched with.
      { kind: "group", name: "DBAs", workspaceGroupId: "tag-1" },
      { kind: "text", text: ": db" },
    ]);
  });

  test("a mention tag no entity names is its name, as text", () => {
    expect(
      MicrosoftTeamsPage.getPageTokens({
        text: "page <at>Ghost</at> db",
        recipient: { id: "28:bot" },
        entities: [],
      }),
    ).toEqual([{ kind: "text", text: " Ghost db" }]);
  });

  test("a tag that never closes is text, to the end", () => {
    expect(
      MicrosoftTeamsPage.getPageTokens({
        text: "page <at>Nawaz db down",
        recipient: { id: "28:bot" },
        entities: [],
      }),
    ).toEqual([{ kind: "text", text: " <at>Nawaz db down" }]);
  });

  test("the same person twice: each tag takes its own entity, in order", () => {
    expect(
      MicrosoftTeamsPage.getPageTokens({
        text: "page <at>Nawaz</at> <at>Nawaz</at>",
        recipient: { id: "28:bot" },
        entities: [
          {
            type: "mention",
            text: "<at>Nawaz</at>",
            mentioned: { id: "29:a", name: "Nawaz" },
          },
          {
            type: "mention",
            text: "<at>Nawaz</at>",
            mentioned: { id: "29:b", name: "Nawaz" },
          },
        ],
      }).filter((token: { kind: string }) => {
        return token.kind === "person";
      }),
    ).toEqual([
      { kind: "person", person: { workspaceUserId: "29:a", name: "Nawaz" } },
      { kind: "person", person: { workspaceUserId: "29:b", name: "Nawaz" } },
    ]);
  });

  test("text as long as a chat sends, and longer: read in time that grows with it", () => {
    const started: number = Date.now();

    MicrosoftTeamsPage.getPageTokens({
      text: `page ${"<at".repeat(150_000)}`,
      recipient: { id: "28:bot" },
      entities: [],
    });
    MicrosoftTeamsPage.getPageTokens({
      text: `page ${"<at>x</at>".repeat(40_000)}`,
      recipient: { id: "28:bot" },
      entities: [],
    });
    MicrosoftTeamsPage.getPageTokens({
      text: `page ${"<at>".repeat(100_000)}</at>`,
      recipient: { id: "28:bot" },
      entities: [],
    });

    expect(Date.now() - started).toBeLessThan(2000);
  });
});
