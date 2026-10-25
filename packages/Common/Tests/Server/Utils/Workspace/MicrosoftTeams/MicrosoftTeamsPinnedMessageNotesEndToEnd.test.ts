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
 * A PINNED MICROSOFT TEAMS MESSAGE, SAVED AS A NOTE, END TO END.
 *
 * Teams does not tell OneUptime about reactions: the reactions sync reads
 * the incident channel's messages from Microsoft Graph once a minute
 * (MicrosoftTeamsReactionNoteSync), and saves a message somebody gave a 📌
 * or a 📣 as a note. Here that runs through the real sync, the real note
 * services' create over in-memory tables, the real Connect request and
 * completion (in an in-memory cache), and the REAL botbuilder stack -
 * CloudAdapter, TurnContext, the Bot Connector client - whose every request
 * goes to a fake Bot Connector on 127.0.0.1, which records it. Graph is a
 * stub that hands over the channel's messages, as its API returns them.
 *
 * How the real botbuilder gets in past Common's jest stubs: see
 * MicrosoftTeamsCreateCommandsEndToEnd.test.ts, whose recipe this copies.
 */

jest.mock("botbuilder", () => {
  return (
    jest.requireActual("../../../../Helpers/RealBotbuilder") as {
      loadRealBotbuilder: (fromFile: string) => unknown;
    }
  ).loadRealBotbuilder(__filename);
});

jest.mock("../../../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    MicrosoftTeamsAppClientId: "11111111-2222-3333-4444-555555555555",
    MicrosoftTeamsAppClientSecret: "test-secret",
    MicrosoftTeamsAppTenantId: "test-tenant",
  };
});

jest.mock("../../../../../Server/Infrastructure/GlobalCache", () => {
  const cache: { store: Map<string, unknown> } = (
    jest.requireActual("../../../API/WorkspaceOAuthTestHelpers") as {
      createInMemoryGlobalCache: () => { store: Map<string, unknown> };
    }
  ).createInMemoryGlobalCache();

  return {
    __esModule: true,
    default: {
      ...cache,
      deleteKey: async (namespace: string, key: string): Promise<void> => {
        cache.store.delete(`${namespace}-${key}`);
      },
    },
  };
});

jest.mock("../../../../../Server/Utils/Logger");

import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
} from "botbuilder";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import User from "../../../../../Models/DatabaseModels/User";
import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import DatabaseConfig from "../../../../../Server/DatabaseConfig";
import IncidentFeedService from "../../../../../Server/Services/IncidentFeedService";
import IncidentInternalNoteService from "../../../../../Server/Services/IncidentInternalNoteService";
import IncidentPublicNoteService from "../../../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import UserService from "../../../../../Server/Services/UserService";
import WorkspaceProjectAuthTokenService from "../../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../../../Server/Services/WorkspaceUserAuthTokenService";
import ProductBrandingText from "../../../../../Server/Utils/ProductBrandingText";
import MicrosoftTeamsUtil from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import MicrosoftTeamsServiceUrl from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsServiceUrl";
import MicrosoftTeamsReactionNoteSync, {
  MicrosoftTeamsReactionOutcome,
  MicrosoftTeamsWatchedChannel,
} from "../../../../../Server/Utils/Workspace/MicrosoftTeams/ReactionNoteSync";
import WorkspaceActionAuthorization from "../../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceConnectCompletion, {
  WorkspaceConnectCompletionResult,
} from "../../../../../Server/Utils/Workspace/WorkspaceConnectCompletion";
import WorkspaceConnectRequest, {
  WorkspaceConnectRequestRecord,
} from "../../../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import { WorkspaceNoteResourceType } from "../../../../../Server/Utils/Workspace/WorkspaceReactionNote";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import URL from "../../../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import { JSONObject } from "../../../../../Types/JSON";
import Name from "../../../../../Types/Name";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { ConnectRequestOutcome } from "../../../../../Types/Workspace/ConnectCallback";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import API from "../../../../../Utils/API";
import { getJestSpyOn } from "../../../../Spy";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../../../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../../../TestingUtils/ProjectDirectory";
import { stubReadableParents } from "../../../TestingUtils/ReadableParents";
import { mockProjectStates } from "../../../TestingUtils/Services/ProjectStatesHelper";

const DASHBOARD_URL: string = "https://oneuptime.test/dashboard";

// The token a Connect button's link carries.
const CONNECT_TOKEN: RegExp = /connect=([A-Za-z0-9_-]{43})/;
const TENANT_ID: string = "4724aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TEAM_ID: string = "graph-team-ops";
const CHANNEL_ID: string = "19:inc-8@thread.tacv2";

const PROJECT_ID: ObjectID = new ObjectID(
  "e4724000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "e4724000-0000-4000-8000-000000000002",
);
const NITIN_ID: ObjectID = new ObjectID("e4724000-0000-4000-8000-0000000000a1");
const CAROL_ID: ObjectID = new ObjectID("e4724000-0000-4000-8000-0000000000a3");

// Microsoft Entra object ids: Nitin is connected; Aidil and Carol are not.
const NITIN: string = "aad-nitin";
const AIDIL: string = "aad-aidil";
const CAROL: string = "aad-carol";

const INCIDENT_LINK: string = `${DASHBOARD_URL}/${PROJECT_ID.toString()}/incidents/${INCIDENT_ID.toString()}`;

const PEOPLE: Record<string, string> = {
  [NITIN]: "Nitin Kumar",
  [AIDIL]: "Aidil Rahman",
  [CAROL]: "Carol Diaz",
};

// ---- The Bot Connector: records every activity the bot sends ----

const ACTIVITIES_PATH: RegExp =
  /^\/v3\/conversations\/([^/]+)\/activities(?:\/([^/]+))?$/;

interface ConnectorPost {
  conversationId: string;
  activity: JSONObject;
}

class FakeBotConnector {
  public serviceUrl: string = "";
  public posts: Array<ConnectorPost> = [];
  private server: http.Server | null = null;
  private nextMessage: number = 1;

  public async start(): Promise<void> {
    this.server = http.createServer(
      (req: http.IncomingMessage, res: http.ServerResponse) => {
        let body: string = "";
        req.setEncoding("utf8");
        req.on("data", (chunk: string) => {
          body += chunk;
        });
        req.on("end", () => {
          const path: string = (req.url || "/").split("?")[0] || "/";
          const match: RegExpExecArray | null = ACTIVITIES_PATH.exec(path);

          if (req.method === "POST" && match) {
            this.posts.push({
              conversationId: decodeURIComponent(match[1] || ""),
              activity: JSON.parse(body || "{}") as JSONObject,
            });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ id: `msg-${this.nextMessage++}` }));
            return;
          }

          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { code: "NotFound" } }));
        });
      },
    );

    await new Promise<void>((resolve: () => void) => {
      this.server!.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });

    this.serviceUrl = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/`;
  }

  public async stop(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve: () => void) => {
      this.server?.close(() => {
        resolve();
      });
    });
  }
}

const connector: FakeBotConnector = new FakeBotConnector();

// ---- Microsoft Graph: the channel's messages, as its API returns them ----

let channelMessages: Array<JSONObject> = [];
let graphReads: number = 0;

function graphMessage(data: {
  id: string;
  from: string;
  html: string;
  minutesAgo: number;
  replyToId?: string | undefined;
  reactions?: Array<JSONObject> | undefined;
}): JSONObject {
  return {
    id: data.id,
    replyToId: data.replyToId || null,
    messageType: "message",
    createdDateTime: new Date(
      Date.now() - data.minutesAgo * 60 * 1000,
    ).toISOString(),
    deletedDateTime: null,
    subject: null,
    webUrl: `https://teams.microsoft.com/l/message/${encodeURIComponent(CHANNEL_ID)}/${data.id}`,
    from: {
      user: {
        id: data.from,
        displayName: PEOPLE[data.from],
        userIdentityType: "aadUser",
      },
    },
    body: { contentType: "html", content: data.html },
    attachments: [],
    reactions: data.reactions || [],
    replies: [],
  };
}

function reaction(by: string, emoji: string, minutesAgo: number): JSONObject {
  return {
    reactionType: emoji,
    displayName: emoji === "📌" ? "Pushpin" : "Megaphone",
    createdDateTime: new Date(
      Date.now() - minutesAgo * 60 * 1000,
    ).toISOString(),
    user: {
      user: {
        id: by,
        displayName: PEOPLE[by],
        userIdentityType: "aadUser",
      },
    },
  };
}

// ---- Who may do what, and OneUptime's records ----

let linked: Map<string, ObjectID> = new Map();
let privateNotes: InMemoryTable;
let publicNotes: InMemoryTable;
let feed: Array<JSONObject> = [];

function memberProps(userId: ObjectID): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: [
      Permission.CurrentUser,
      Permission.ProjectUser,
      Permission.IncidentMember,
    ].map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
        scope: PermissionScope.All,
      };
    }),
  };

  return {
    userId: userId,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
    currentPlan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  };
}

const ONEUPTIME_NAMES: Record<string, string> = {
  [NITIN_ID.toString()]: "Nitin Kumar",
  [CAROL_ID.toString()]: "Carol Diaz",
};

const CHANNEL: MicrosoftTeamsWatchedChannel = {
  resource: {
    resourceType: WorkspaceNoteResourceType.Incident,
    resourceId: INCIDENT_ID,
    projectId: PROJECT_ID,
  },
  channelId: CHANNEL_ID,
  teamId: TEAM_ID,
};

async function syncRun(): Promise<Array<MicrosoftTeamsReactionOutcome>> {
  return await MicrosoftTeamsReactionNoteSync.syncChannel({
    projectId: PROJECT_ID,
    authToken: "teams-token",
    channel: CHANNEL,
  });
}

// The text of a card the bot sent: its text blocks, then its buttons.
function cardOf(post: ConnectorPost): {
  text: string;
  buttons: Array<JSONObject>;
  mentions: Array<JSONObject>;
} {
  const card: JSONObject = ((
    post.activity["attachments"] as Array<JSONObject>
  )[0]!["content"] || {}) as JSONObject;

  return {
    text: ((card["body"] as Array<JSONObject>) || [])
      .map((element: JSONObject): string => {
        return String(element["text"] || "");
      })
      .join("\n"),
    buttons: (card["actions"] as Array<JSONObject>) || [],
    mentions: ((card["msteams"] as JSONObject | undefined)?.["entities"] ||
      []) as Array<JSONObject>,
  };
}

beforeAll(async () => {
  await connector.start();
});

afterAll(async () => {
  await connector.stop();
});

beforeEach(() => {
  connector.posts = [];
  channelMessages = [];
  graphReads = 0;
  feed = [];
  linked = new Map([[NITIN, NITIN_ID]]);
  (
    jest.requireMock("../../../../../Server/Infrastructure/GlobalCache") as {
      default: { store: Map<string, unknown> };
    }
  ).default.store.clear();

  (
    MicrosoftTeamsUtil as unknown as { cachedAdapter: CloudAdapter | null }
  ).cachedAdapter = new CloudAdapter(
    new ConfigurationBotFrameworkAuthentication({}),
  );

  // Proactive sends go to the fake Bot Connector.
  getJestSpyOn(MicrosoftTeamsServiceUrl, "resolve").mockImplementation(() => {
    return connector.serviceUrl;
  });
  getJestSpyOn(MicrosoftTeamsUtil, "getValidAccessToken").mockResolvedValue(
    "graph-token",
  );

  // Microsoft Graph: the incident channel's recent threads, with replies.
  getJestSpyOn(API, "get").mockImplementation((async (options: {
    url: URL;
  }): Promise<HTTPResponse<JSONObject>> => {
    graphReads++;
    expect(options.url.toString()).toBe(
      `https://graph.microsoft.com/v1.0/teams/${TEAM_ID}/channels/${encodeURIComponent(CHANNEL_ID)}/messages?$top=50&$expand=replies`,
    );
    return new HTTPResponse<JSONObject>(
      200,
      { value: JSON.parse(JSON.stringify(channelMessages)) },
      {},
    );
  }) as never);

  mockProjectStates();
  stubProjectDirectory({});
  stubReadableParents();

  const projectAuth: () => WorkspaceProjectAuthToken =
    (): WorkspaceProjectAuthToken => {
      const token: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
      token.projectId = PROJECT_ID;
      token.authToken = "teams-token";
      token.workspaceType = WorkspaceType.MicrosoftTeams;
      token.workspaceProjectId = TENANT_ID;
      token.miscData = {
        tenantId: TENANT_ID,
        teamId: TEAM_ID,
        teamName: "Ops",
        installedTeams: {
          [TEAM_ID]: {
            id: TEAM_ID,
            graphTeamId: TEAM_ID,
            name: "Ops",
            serviceUrl: "https://smba.trafficmanager.net/teams/",
          },
        },
      } as never;
      return token;
    };

  getJestSpyOn(
    WorkspaceProjectAuthTokenService,
    "getProjectAuth",
  ).mockImplementation((async () => {
    return projectAuth();
  }) as never);
  getJestSpyOn(
    WorkspaceProjectAuthTokenService,
    "findOneBy",
  ).mockImplementation((async () => {
    return projectAuth();
  }) as never);

  getJestSpyOn(WorkspaceUserAuthTokenService, "findOneBy").mockImplementation(
    (async (options: { query: { workspaceUserId: string } }) => {
      const userId: ObjectID | undefined = linked.get(
        options.query.workspaceUserId,
      );

      if (!userId) {
        return null;
      }

      const userAuth: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
      userAuth.userId = userId;
      return userAuth;
    }) as never,
  );

  getJestSpyOn(WorkspaceActionAuthorization, "authorize").mockImplementation(
    (async (data: { userId: ObjectID }) => {
      return memberProps(data.userId);
    }) as never,
  );

  privateNotes = useInMemoryTable(IncidentInternalNoteService, []);
  publicNotes = useInMemoryTable(IncidentPublicNoteService, []);

  for (const service of [
    IncidentInternalNoteService,
    IncidentPublicNoteService,
  ]) {
    getJestSpyOn(service as never, "getAttachmentsMarkdown").mockResolvedValue(
      "" as never,
    );
  }

  getJestSpyOn(IncidentService, "findOneBy").mockResolvedValue(null);
  getJestSpyOn(IncidentService, "getIncidentNumber").mockResolvedValue({
    number: 8,
    numberWithPrefix: "INC-8",
  });
  getJestSpyOn(IncidentService, "getIncidentLinkInDashboard").mockResolvedValue(
    URL.fromString(INCIDENT_LINK),
  );

  getJestSpyOn(
    IncidentFeedService,
    "createIncidentFeedItem",
  ).mockImplementation((async (data: JSONObject) => {
    feed.push(data);
  }) as never);

  getJestSpyOn(UserService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
  }) => {
    const name: string | undefined = ONEUPTIME_NAMES[data.id.toString()];

    if (!name) {
      return null;
    }

    const user: User = new User();
    user.name = new Name(name);
    return user;
  }) as never);

  getJestSpyOn(DatabaseConfig, "getDashboardUrl").mockResolvedValue(
    URL.fromString(DASHBOARD_URL),
  );
  getJestSpyOn(ProductBrandingText, "getProductName").mockReturnValue(
    "OneUptime",
  );
});

afterEach(() => {
  jest.restoreAllMocks();
  (
    MicrosoftTeamsUtil as unknown as { cachedAdapter: CloudAdapter | null }
  ).cachedAdapter = null;
});

describe("a pinned Microsoft Teams message, saved as a note", () => {
  test("Aidil's words, as Teams showed them, filed when he wrote them, saved by Nitin, confirmed once in the thread", async () => {
    channelMessages = [
      graphMessage({
        id: "1700000000100",
        from: AIDIL,
        minutesAgo: 90,
        html: '<p><strong>Root cause:</strong> the pool size, cc <at id="0">Nitin Kumar</at> - see <a href="https://wiki.example.com/rca">the RCA</a></p><ul><li>rolled back</li></ul>',
        reactions: [reaction(NITIN, "📌", 1)],
      }),
    ];

    expect(await syncRun()).toEqual([MicrosoftTeamsReactionOutcome.Saved]);

    expect(privateNotes.inserts).toHaveLength(1);
    const note: StoredRow = privateNotes.inserts[0]!;
    const postedAt: Date = new Date(
      String(channelMessages[0]!["createdDateTime"]),
    );

    expect(note["note"]).toBe(
      "**Root cause:** the pool size, cc @Nitin Kumar - see [the RCA](https://wiki.example.com/rca)\n\n- rolled back",
    );
    expect(String(note["createdByUserId"])).toBe(NITIN_ID.toString());
    expect(note["postedAt"]).toEqual(postedAt);
    expect(note["postedFromSlackMessageId"]).toBe(
      `${CHANNEL_ID}:1700000000100`,
    );
    expect(note["savedFromChatMessage"]).toEqual({
      workspaceType: WorkspaceType.MicrosoftTeams,
      authorName: "Aidil Rahman",
      postedAt: postedAt.toISOString(),
    });

    expect(feed).toHaveLength(1);
    expect(String(feed[0]!["feedInfoInMarkdown"])).toBe(
      `📄 **Aidil Rahman** posted **private note** for this [Incident INC-8](${INCIDENT_LINK}) via Microsoft Teams (note added by Nitin Kumar):\n\n**Root cause:** the pool size, cc @Nitin Kumar - see [the RCA](https://wiki.example.com/rca)\n\n- rolled back`,
    );
    expect(
      (feed[0]!["workspaceNotification"] as JSONObject)["exceptChannel"],
    ).toEqual({
      workspaceType: WorkspaceType.MicrosoftTeams,
      channelId: CHANNEL_ID,
    });

    // The Bot Connector: one reply, in the message's thread, and nothing else.
    expect(connector.posts).toHaveLength(1);
    expect(connector.posts[0]!.conversationId).toBe(
      `${CHANNEL_ID};messageid=1700000000100`,
    );
    expect(connector.posts[0]!.activity["type"]).toBe("message");
    expect(connector.posts[0]!.activity["textFormat"]).toBe("markdown");
    expect(connector.posts[0]!.activity["text"]).toBe(
      `✅ Saved as a **private note** on [Incident INC-8](${INCIDENT_LINK}).`,
    );
  });

  test("the next runs see the same pin: no second note, no second reply", async () => {
    channelMessages = [
      graphMessage({
        id: "1700000000100",
        from: AIDIL,
        minutesAgo: 30,
        html: "<p>Restarted the primary DB</p>",
        reactions: [reaction(NITIN, "📌", 2)],
      }),
    ];

    await syncRun();
    expect(await syncRun()).toEqual([
      MicrosoftTeamsReactionOutcome.AlreadyHandled,
    ]);
    await syncRun();

    expect(privateNotes.inserts).toHaveLength(1);
    expect(connector.posts).toHaveLength(1);
    expect(graphReads).toBe(3);
  });

  test("a reply in a thread is confirmed under its thread's first message; a 📣 is a public note", async () => {
    const root: JSONObject = graphMessage({
      id: "1700000000100",
      from: NITIN,
      minutesAgo: 20,
      html: "<p>What changed in the last deploy?</p>",
    });
    root["replies"] = [
      graphMessage({
        id: "1700000000200",
        from: AIDIL,
        minutesAgo: 10,
        replyToId: "1700000000100",
        html: "<p>Database failover complete; error rates are back to normal.</p>",
        reactions: [reaction(NITIN, "📣", 1)],
      }),
    ];
    channelMessages = [root];

    expect(await syncRun()).toEqual([MicrosoftTeamsReactionOutcome.Saved]);

    expect(privateNotes.inserts).toHaveLength(0);
    expect(publicNotes.inserts).toHaveLength(1);
    expect(publicNotes.inserts[0]!["note"]).toBe(
      "Database failover complete; error rates are back to normal.",
    );
    expect(connector.posts).toHaveLength(1);
    expect(connector.posts[0]!.conversationId).toBe(
      `${CHANNEL_ID};messageid=1700000000100`,
    );
    expect(connector.posts[0]!.activity["text"]).toBe(
      `✅ Saved as a **public note** on [Incident INC-8](${INCIDENT_LINK}). It is shown on the status page.`,
    );
  });
});

describe("a Microsoft Teams message that cannot be saved", () => {
  test("a 📣 on a message of only a file: Nitin is told why, by a card that mentions him, in the thread", async () => {
    const message: JSONObject = graphMessage({
      id: "1700000000100",
      from: AIDIL,
      minutesAgo: 10,
      html: '<p><attachment id="f1"></attachment></p>',
      reactions: [reaction(NITIN, "📣", 1)],
    });
    message["attachments"] = [
      {
        id: "f1",
        contentType: "reference",
        contentUrl:
          "https://acme.sharepoint.com/sites/ops/Shared%20Documents/p99.png",
        name: "p99.png",
      },
    ];
    channelMessages = [message];

    expect(await syncRun()).toEqual([MicrosoftTeamsReactionOutcome.NoText]);

    expect(publicNotes.inserts).toHaveLength(0);
    expect(feed).toHaveLength(0);
    expect(connector.posts).toHaveLength(1);

    const post: ConnectorPost = connector.posts[0]!;
    const card: {
      text: string;
      buttons: Array<JSONObject>;
      mentions: Array<JSONObject>;
    } = cardOf(post);

    expect(post.conversationId).toBe(`${CHANNEL_ID};messageid=1700000000100`);
    expect(card.text).toBe(
      "<at>Nitin Kumar</at> The message you reacted to has only files or images, which the status page does not show, so it was not saved as a public note.",
    );
    expect(card.mentions).toEqual([
      {
        type: "mention",
        text: "<at>Nitin Kumar</at>",
        mentioned: { id: NITIN, name: "Nitin Kumar" },
      },
    ]);
    expect(card.buttons).toHaveLength(0);
    // What a notification shows.
    expect(post.activity["summary"]).toBe(
      "The message you reacted to has only files or images, which the status page does not show, so it was not saved as a public note.",
    );

    // The next runs leave it: answered once.
    await syncRun();
    expect(connector.posts).toHaveLength(1);
  });

  test("a member who may not add the note is told so by a card that mentions them, and nothing is saved", async () => {
    jest
      .spyOn(WorkspaceActionAuthorization, "authorize")
      .mockRejectedValue(
        new NotAuthorizedException(
          "You do not have permission to add a private note to this incident.",
        ),
      );
    channelMessages = [
      graphMessage({
        id: "1700000000100",
        from: AIDIL,
        minutesAgo: 10,
        html: "<p>Restarted the primary DB</p>",
        reactions: [reaction(NITIN, "📌", 1)],
      }),
    ];

    expect(await syncRun()).toEqual([
      MicrosoftTeamsReactionOutcome.NotAuthorized,
    ]);

    expect(privateNotes.inserts).toHaveLength(0);
    expect(connector.posts).toHaveLength(1);
    expect(cardOf(connector.posts[0]!).text).toBe(
      "<at>Nitin Kumar</at> You do not have permission to add a private note to this incident.",
    );
  });
});

describe("somebody not connected who pins a Microsoft Teams message", () => {
  function carolsPin(): void {
    channelMessages = [
      graphMessage({
        id: "1700000000100",
        from: AIDIL,
        minutesAgo: 40,
        html: "<p>Not sure what's happening here, is this triggered by something?</p>",
        reactions: [reaction(CAROL, "📌", 1)],
      }),
    ];
  }

  test("is asked once, by name, with a Connect button; connecting saves the message, confirmed once", async () => {
    carolsPin();

    expect(await syncRun()).toEqual([MicrosoftTeamsReactionOutcome.NotLinked]);
    // The next runs: the pin waits, and Carol is not asked again.
    expect(await syncRun()).toEqual([MicrosoftTeamsReactionOutcome.NotLinked]);
    await syncRun();

    expect(privateNotes.inserts).toHaveLength(0);
    expect(connector.posts).toHaveLength(1);

    const post: ConnectorPost = connector.posts[0]!;
    const card: {
      text: string;
      buttons: Array<JSONObject>;
      mentions: Array<JSONObject>;
    } = cardOf(post);

    expect(post.conversationId).toBe(`${CHANNEL_ID};messageid=1700000000100`);
    expect(card.text).toBe(
      "<at>Carol Diaz</at> 🔗 **Connect your Microsoft Teams account to save the message you reacted to as a private note on this incident.** It takes one click, and OneUptime saves it for you as soon as you're connected.",
    );
    expect(card.mentions).toEqual([
      {
        type: "mention",
        text: "<at>Carol Diaz</at>",
        mentioned: { id: CAROL, name: "Carol Diaz" },
      },
    ]);
    expect(card.buttons).toHaveLength(1);
    expect(card.buttons[0]!["type"]).toBe("Action.OpenUrl");

    const token: string = CONNECT_TOKEN.exec(
      String(card.buttons[0]!["url"]),
    )![1]!;
    const request: WorkspaceConnectRequestRecord | null =
      await WorkspaceConnectRequest.take(token);

    expect(request!.workspaceType).toBe(WorkspaceType.MicrosoftTeams);
    expect(request!.workspaceUserId).toBe(CAROL);
    expect(request!.pendingAction!.message).toEqual({
      channelId: CHANNEL_ID,
      messageId: "1700000000100",
      teamId: TEAM_ID,
    });

    // Carol connects: the channel is read again, and her pin saved.
    linked.set(CAROL, CAROL_ID);
    connector.posts = [];

    const result: WorkspaceConnectCompletionResult =
      await WorkspaceConnectCompletion.complete({
        request: request!,
        userId: CAROL_ID,
      });

    expect(result).toEqual({
      outcome: ConnectRequestOutcome.Done,
      answer: {
        markdown: `✅ **Your Microsoft Teams account is connected to OneUptime.** You saved the message as a private note on **[Incident INC-8](${INCIDENT_LINK})**.`,
        text: "Your Microsoft Teams account is connected to OneUptime. You saved the message as a private note on Incident INC-8",
      },
    });
    expect(privateNotes.inserts).toHaveLength(1);
    expect(String(privateNotes.inserts[0]!["createdByUserId"])).toBe(
      CAROL_ID.toString(),
    );
    expect(String(feed[0]!["feedInfoInMarkdown"])).toContain(
      "via Microsoft Teams (note added by Carol Diaz):",
    );
    expect(connector.posts).toHaveLength(1);
    expect(connector.posts[0]!.activity["text"]).toBe(
      `✅ Saved as a **private note** on [Incident INC-8](${INCIDENT_LINK}).`,
    );

    // And the next run leaves it: saved once.
    connector.posts = [];
    await syncRun();

    expect(privateNotes.inserts).toHaveLength(1);
    expect(connector.posts).toHaveLength(0);
  });

  test("a pin taken off before connecting saves nothing, and says so", async () => {
    carolsPin();
    await syncRun();

    const token: string = CONNECT_TOKEN.exec(
      String(cardOf(connector.posts[0]!).buttons[0]!["url"]),
    )![1]!;

    channelMessages[0]!["reactions"] = [];
    linked.set(CAROL, CAROL_ID);
    connector.posts = [];

    const result: WorkspaceConnectCompletionResult =
      await WorkspaceConnectCompletion.complete({
        request: (await WorkspaceConnectRequest.take(token))!,
        userId: CAROL_ID,
      });

    expect(result.outcome).toBe(ConnectRequestOutcome.Answered);
    // The message is there: her reaction is what is gone.
    expect(result.answer.text).toBe(
      "Your Microsoft Teams account is connected to OneUptime. The message, or your reaction to it, is no longer there, so nothing was saved",
    );
    expect(privateNotes.inserts).toHaveLength(0);
    expect(connector.posts).toHaveLength(0);
  });
});

/*
 * A 📣 IN A PRIVATE INCIDENT'S MICROSOFT TEAMS CHANNEL.
 *
 * A private incident takes no public notes (Types/StatusPage/
 * PrivateRecordPublicNotes): a public note on it reaches no status page and
 * no subscriber, and the server refuses one. A 📣 there - read from Graph by
 * the real sync, saved by the real note services, answered through the real
 * botbuilder stack - is saved as a private note, its files kept as a private
 * note keeps them, and the one confirmation in its thread says why.
 * Somebody not connected is asked to save it as a private note, and once
 * they connect it is saved so.
 */
describe("a 📣 in a private incident's Microsoft Teams channel", () => {
  const PRIVATELY_SAVED: string = `✅ Saved as a **private note** on [Incident INC-8](${INCIDENT_LINK}). The incident is private, so public notes cannot be added to it.`;

  // Incident INC-8 is private.
  function makeIncidentPrivate(): void {
    getJestSpyOn(IncidentService, "findOneBy").mockImplementation(
      (async (options: {
        query: { _id?: unknown };
      }): Promise<Incident | null> => {
        if (String(options.query._id) !== INCIDENT_ID.toString()) {
          return null;
        }

        const incident: Incident = new Incident();
        incident._id = INCIDENT_ID.toString();
        incident.projectId = PROJECT_ID;
        incident.isPrivate = true;
        return incident;
      }) as never,
    );
  }

  beforeEach(() => {
    makeIncidentPrivate();
  });

  test("Nitin's 📣 saves Aidil's words as a private note, confirmed once in the thread, with the reason", async () => {
    channelMessages = [
      graphMessage({
        id: "1700000000100",
        from: AIDIL,
        minutesAgo: 30,
        html: "<p>Database failover complete; error rates are back to normal.</p>",
        reactions: [reaction(NITIN, "📣", 1)],
      }),
    ];

    expect(await syncRun()).toEqual([MicrosoftTeamsReactionOutcome.Saved]);

    // No public note at all: a private one, Aidil's words, saved by Nitin.
    expect(publicNotes.inserts).toHaveLength(0);
    expect(privateNotes.inserts).toHaveLength(1);
    expect(privateNotes.inserts[0]!["note"]).toBe(
      "Database failover complete; error rates are back to normal.",
    );
    expect(String(privateNotes.inserts[0]!["createdByUserId"])).toBe(
      NITIN_ID.toString(),
    );
    expect(String(feed[0]!["feedInfoInMarkdown"])).toContain(
      `posted **private note** for this [Incident INC-8](${INCIDENT_LINK})`,
    );

    // One reply, in the message's thread: what it became, and why.
    expect(connector.posts).toHaveLength(1);
    expect(connector.posts[0]!.conversationId).toBe(
      `${CHANNEL_ID};messageid=1700000000100`,
    );
    expect(connector.posts[0]!.activity["textFormat"]).toBe("markdown");
    expect(connector.posts[0]!.activity["text"]).toBe(PRIVATELY_SAVED);
    expect(String(connector.posts[0]!.activity["text"])).not.toContain(
      "status page",
    );

    // The next runs leave it: saved once, answered once.
    await syncRun();
    await syncRun();

    expect(privateNotes.inserts).toHaveLength(1);
    expect(connector.posts).toHaveLength(1);
  });

  test("a 📣 on a message of only a file keeps the file, as a private note does", async () => {
    const message: JSONObject = graphMessage({
      id: "1700000000100",
      from: AIDIL,
      minutesAgo: 10,
      html: '<p><attachment id="f1"></attachment></p>',
      reactions: [reaction(NITIN, "📣", 1)],
    });
    message["attachments"] = [
      {
        id: "f1",
        contentType: "reference",
        contentUrl:
          "https://acme.sharepoint.com/sites/ops/Shared%20Documents/p99.png",
        name: "p99.png",
      },
    ];
    channelMessages = [message];

    // Not refused for having only a file: no status page shows it.
    expect(await syncRun()).toEqual([MicrosoftTeamsReactionOutcome.Saved]);

    expect(publicNotes.inserts).toHaveLength(0);
    expect(privateNotes.inserts).toHaveLength(1);
    expect(String(privateNotes.inserts[0]!["note"])).toContain(
      "[p99.png](https://acme.sharepoint.com/sites/ops/Shared%20Documents/p99.png)",
    );
    expect(connector.posts).toHaveLength(1);
    expect(connector.posts[0]!.activity["text"]).toBe(PRIVATELY_SAVED);
  });

  test("a 📌 and a 📣 on the same message save it once, confirmed once", async () => {
    channelMessages = [
      graphMessage({
        id: "1700000000100",
        from: AIDIL,
        minutesAgo: 30,
        html: "<p>Restarted the primary DB</p>",
        reactions: [reaction(NITIN, "📌", 2), reaction(NITIN, "📣", 1)],
      }),
    ];

    expect(await syncRun()).toEqual([
      MicrosoftTeamsReactionOutcome.Saved,
      MicrosoftTeamsReactionOutcome.AlreadySaved,
    ]);

    expect(privateNotes.inserts).toHaveLength(1);
    expect(publicNotes.inserts).toHaveLength(0);
    expect(connector.posts).toHaveLength(1);
    // The pin saved it, and its confirmation is as it always was.
    expect(connector.posts[0]!.activity["text"]).toBe(
      `✅ Saved as a **private note** on [Incident INC-8](${INCIDENT_LINK}).`,
    );
  });

  test("Carol, not connected, is asked to save it as a private note; connecting saves it so, confirmed once", async () => {
    channelMessages = [
      graphMessage({
        id: "1700000000100",
        from: AIDIL,
        minutesAgo: 40,
        html: "<p>Is this the payroll export?</p>",
        reactions: [reaction(CAROL, "📣", 1)],
      }),
    ];

    expect(await syncRun()).toEqual([MicrosoftTeamsReactionOutcome.NotLinked]);
    expect(connector.posts).toHaveLength(1);

    const card: {
      text: string;
      buttons: Array<JSONObject>;
      mentions: Array<JSONObject>;
    } = cardOf(connector.posts[0]!);

    expect(card.text).toBe(
      "<at>Carol Diaz</at> 🔗 **Connect your Microsoft Teams account to save the message you reacted to as a private note on this incident.** It takes one click, and OneUptime saves it for you as soon as you're connected.",
    );

    const token: string = CONNECT_TOKEN.exec(
      String(card.buttons[0]!["url"]),
    )![1]!;

    linked.set(CAROL, CAROL_ID);
    connector.posts = [];

    const result: WorkspaceConnectCompletionResult =
      await WorkspaceConnectCompletion.complete({
        request: (await WorkspaceConnectRequest.take(token))!,
        userId: CAROL_ID,
      });

    expect(result).toEqual({
      outcome: ConnectRequestOutcome.Done,
      answer: {
        markdown: `✅ **Your Microsoft Teams account is connected to OneUptime.** You saved the message as a private note on **[Incident INC-8](${INCIDENT_LINK})**.`,
        text: "Your Microsoft Teams account is connected to OneUptime. You saved the message as a private note on Incident INC-8",
      },
    });
    expect(publicNotes.inserts).toHaveLength(0);
    expect(privateNotes.inserts).toHaveLength(1);
    expect(String(privateNotes.inserts[0]!["createdByUserId"])).toBe(
      CAROL_ID.toString(),
    );
    expect(connector.posts).toHaveLength(1);
    expect(connector.posts[0]!.activity["text"]).toBe(PRIVATELY_SAVED);

    // And the next run leaves it: saved once.
    connector.posts = [];
    await syncRun();

    expect(privateNotes.inserts).toHaveLength(1);
    expect(connector.posts).toHaveLength(0);
  });

  test("an incident made private after Carol was asked is saved private when she connects", async () => {
    // Not private when Carol reacts...
    getJestSpyOn(IncidentService, "findOneBy").mockResolvedValue(null);

    channelMessages = [
      graphMessage({
        id: "1700000000100",
        from: AIDIL,
        minutesAgo: 40,
        html: "<p>Is this the payroll export?</p>",
        reactions: [reaction(CAROL, "📣", 1)],
      }),
    ];

    await syncRun();

    const card: {
      text: string;
      buttons: Array<JSONObject>;
      mentions: Array<JSONObject>;
    } = cardOf(connector.posts[0]!);

    expect(card.text).toContain(
      "to save the message you reacted to as a public note on this incident.",
    );

    const token: string = CONNECT_TOKEN.exec(
      String(card.buttons[0]!["url"]),
    )![1]!;

    // ...and private by the time she connects.
    makeIncidentPrivate();
    linked.set(CAROL, CAROL_ID);
    connector.posts = [];

    const result: WorkspaceConnectCompletionResult =
      await WorkspaceConnectCompletion.complete({
        request: (await WorkspaceConnectRequest.take(token))!,
        userId: CAROL_ID,
      });

    expect(result.answer.text).toBe(
      "Your Microsoft Teams account is connected to OneUptime. You saved the message as a private note on Incident INC-8",
    );
    expect(publicNotes.inserts).toHaveLength(0);
    expect(privateNotes.inserts).toHaveLength(1);
    expect(connector.posts[0]!.activity["text"]).toBe(PRIVATELY_SAVED);
  });

  test("made public again, a 📣 is a public note once more", async () => {
    getJestSpyOn(IncidentService, "findOneBy").mockResolvedValue(null);

    channelMessages = [
      graphMessage({
        id: "1700000000100",
        from: AIDIL,
        minutesAgo: 30,
        html: "<p>Database failover complete; error rates are back to normal.</p>",
        reactions: [reaction(NITIN, "📣", 1)],
      }),
    ];

    expect(await syncRun()).toEqual([MicrosoftTeamsReactionOutcome.Saved]);

    expect(privateNotes.inserts).toHaveLength(0);
    expect(publicNotes.inserts).toHaveLength(1);
    expect(connector.posts[0]!.activity["text"]).toBe(
      `✅ Saved as a **public note** on [Incident INC-8](${INCIDENT_LINK}). It is shown on the status page.`,
    );
  });
});
