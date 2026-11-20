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
 * A PAGE FROM A MICROSOFT TEAMS PERSONAL CHAT, FOLLOWED THERE - END TO END
 * (issue #9284).
 *
 * Jane messages the OneUptime bot in her personal chat with it, and pages
 * Nitin about a new alert. The chat is where she asked, so it is kept as a
 * page request place of the alert (WorkspacePage.keepPlace), and the run's
 * card goes there too, edited as the run goes, with its alarms.
 *
 * A personal chat's id ("a:1...") is 130 characters and more, and the place
 * used to be kept cut to 100: an id of no chat. Every post of the run there
 * failed with "This chat is not connected to OneUptime. Please add the
 * OneUptime app to the chat in Microsoft Teams and try again.", and Jane
 * saw nothing of the page she started - which is what the report says.
 *
 * Through OneUptime's real page place, run message, live messages and
 * MicrosoftTeamsUtil, and the REAL botbuilder stack: every card OneUptime
 * sends or edits leaves as an HTTP request to a fake Bot Connector on
 * 127.0.0.1, which records it (as QuietChannelsTeamsEndToEnd does). A new
 * card in a chat is a POST to the chat's conversation; an edit is a PUT of
 * its activity there - a chat has no threads.
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

jest.mock("../../../../../Server/Utils/Logger");

import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  TeamsInfo,
  type TeamsPagedMembersResult,
  type TurnContext,
} from "botbuilder";
import WorkspaceLiveMessage from "../../../../../Models/DatabaseModels/WorkspaceLiveMessage";
import WorkspaceNotificationLog from "../../../../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspaceProjectAuthToken, {
  MicrosoftTeamsMiscData,
} from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import {
  OnCallPageRecordType,
  OnCallPageResult,
} from "../../../../../Server/Services/OnCallPageService";
import WorkspaceNotificationLogService, {
  Service as WorkspaceNotificationLogServiceClass,
} from "../../../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceProjectAuthTokenService from "../../../../../Server/Services/WorkspaceProjectAuthTokenService";
import OnCallPolicyRunMessage from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import MicrosoftTeamsUtil from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import MicrosoftTeamsCutChatIds from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCutChatIds";
import MicrosoftTeamsServiceUrl from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsServiceUrl";
import WorkspacePage, {
  WorkspacePagePlace,
} from "../../../../../Server/Utils/Workspace/WorkspacePage";
import HTTPResponse from "../../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { ON_CALL_DIRECT_PAGE_ACKNOWLEDGE_WAIT_IN_MINUTES } from "../../../../../Types/OnCallDutyPolicy/OnCallDirectPage";
import WorkspaceLiveMessageKey, {
  WorkspaceLiveMessageDestinationType,
  WorkspaceLiveMessagePageRecordType,
} from "../../../../../Types/Workspace/WorkspaceLiveMessageKey";
import WorkspaceNotificationStatus from "../../../../../Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import API from "../../../../../Utils/API";
import QuietChannelsWorld, {
  ALERT_ID,
  JANE,
  NITIN,
  PROJECT_ID,
  STATE_ACKNOWLEDGED,
  WORKSPACE_RULE_ID,
} from "./QuietChannelsWorld";

// Jane's personal chat with the bot, as the Bot Framework names it: 131 characters.
const PERSONAL_CHAT_ID: string =
  "a:1BfcDQQeKz2oG1CPSFyD5ZD1flTYm2IoCY23DqeeVgq6wyCCFf9P43FAqqDYNLI-pephf2ltim4CcrRj_ti04mQkhsHSJDCY_Wsu7XBF4qh8qmhl2nGt9cSEa704tfJxn";

// What the chat used to be kept as.
const CUT_PERSONAL_CHAT_ID: string = PERSONAL_CHAT_ID.substring(0, 100);

const NOT_CONNECTED: string =
  "This chat is not connected to OneUptime. Please add the OneUptime app to the chat in Microsoft Teams and try again.";

// The alert's own channel, where its messages go.
const ALERT_CHANNEL: string = "19:alert-12@thread.tacv2";
const TEAM_ID: string = "graph-team-ops";

// What Jane typed: the alert's title, as in the report.
const TITLE: string = "Test";

// Send and update, as botframework-connector calls them.
const ACTIVITIES_PATH: RegExp =
  /^\/v3\/conversations\/([^/]+)\/activities(?:\/([^/]+))?$/;

interface ConnectorRequest {
  method: string;
  conversationId: string;
  activityIdInPath: string | null;
  activity: JSONObject | null;
  // The card's text blocks, one per line.
  text: string;
  // The id the connector gave a new message.
  answeredId: string | null;
}

// The texts of an Adaptive Card's body, one per line.
function cardText(activity: JSONObject | null): string {
  const attachments: Array<JSONObject> =
    (activity?.["attachments"] as Array<JSONObject> | undefined) || [];
  const lines: Array<string> = [];

  for (const attachment of attachments) {
    const card: JSONObject = (attachment["content"] as JSONObject) || {};

    for (const element of (card["body"] as Array<JSONObject>) || []) {
      lines.push(String(element["text"] || ""));
    }
  }

  return lines.join("\n");
}

class FakeBotConnector {
  public serviceUrl: string = "";
  public requests: Array<ConnectorRequest> = [];
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
          let activity: JSONObject | null = null;

          try {
            activity = body ? (JSON.parse(body) as JSONObject) : null;
          } catch {
            activity = null;
          }

          let answer: JSONObject = { error: { code: "NotFound" } };
          let status: number = 404;

          if (match && req.method === "POST") {
            status = 200;
            answer = { id: `1:1activity-${this.nextMessage++}` };
          } else if (match && req.method === "PUT" && match[2]) {
            status = 200;
            answer = { id: decodeURIComponent(match[2]) };
          }

          this.requests.push({
            method: req.method || "",
            conversationId: match?.[1] ? decodeURIComponent(match[1]) : "",
            activityIdInPath: match?.[2] ? decodeURIComponent(match[2]) : null,
            activity: activity,
            text: cardText(activity),
            answeredId:
              req.method === "POST" && match ? String(answer["id"]) : null,
          });

          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(answer));
        });
      },
    );

    await new Promise<void>((resolve: () => void) => {
      this.server!.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });

    const address: AddressInfo = this.server.address() as AddressInfo;
    this.serviceUrl = `http://127.0.0.1:${address.port}/`;
  }

  public async stop(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((resolve: () => void) => {
      this.server?.close(() => {
        resolve();
      });
    });
  }

  // New cards in one conversation.
  public posts(conversationId: string): Array<ConnectorRequest> {
    return this.requests.filter((request: ConnectorRequest): boolean => {
      return (
        request.method === "POST" && request.conversationId === conversationId
      );
    });
  }

  // Edits of cards in one conversation.
  public updates(conversationId: string): Array<ConnectorRequest> {
    return this.requests.filter((request: ConnectorRequest): boolean => {
      return (
        request.method === "PUT" && request.conversationId === conversationId
      );
    });
  }

  // The chat's page card: the post that names who is paging.
  public pageCard(conversationId: string): ConnectorRequest | undefined {
    return this.posts(conversationId).find(
      (post: ConnectorRequest): boolean => {
        return post.text.indexOf("is paging for") !== -1;
      },
    );
  }
}

const connector: FakeBotConnector = new FakeBotConnector();
let world: QuietChannelsWorld;
let logs: Array<WorkspaceNotificationLog>;

beforeAll(async () => {
  await connector.start();
});

afterAll(async () => {
  await connector.stop();
});

beforeEach(() => {
  connector.requests = [];

  (
    MicrosoftTeamsUtil as unknown as { cachedAdapter: CloudAdapter | null }
  ).cachedAdapter = new CloudAdapter(
    new ConfigurationBotFrameworkAuthentication({}),
  );

  // Proactive sends go to the fake Bot Connector.
  jest.spyOn(MicrosoftTeamsServiceUrl, "resolve").mockImplementation(() => {
    return connector.serviceUrl;
  });

  jest
    .spyOn(MicrosoftTeamsUtil, "getValidAccessToken")
    .mockResolvedValue("graph-token");

  // Microsoft Graph: the alert channel's name.
  jest.spyOn(API, "get").mockImplementation((async (): Promise<
    HTTPResponse<JSONObject>
  > => {
    const channel: JSONObject = {
      displayName: "alert-12",
      membershipType: "standard",
    };
    return {
      data: channel,
      jsonData: channel,
    } as unknown as HTTPResponse<JSONObject>;
  }) as never);

  world = new QuietChannelsWorld({
    workspaces: [WorkspaceType.MicrosoftTeams],
    channels: {
      teams: {
        id: ALERT_CHANNEL,
        name: "alert-12",
        workspaceType: WorkspaceType.MicrosoftTeams,
        teamId: TEAM_ID,
        notificationRuleId: WORKSPACE_RULE_ID.toString(),
      },
    },
  });
  world.runFor = "alert";
  world.recordStateName = "Created";
  world.recordTitle = TITLE;
  // The bot registered Jane's personal chat when she added the app.
  world.teamsChats = {
    [PERSONAL_CHAT_ID]: {
      id: PERSONAL_CHAT_ID,
      name: "Jane Doe",
      chatType: "personal",
      serviceUrl: "https://smba.trafficmanager.net/teams/",
    },
  };
  world.install();

  // Notification Logs, each as the log's create keeps it.
  logs = [];
  jest
    .spyOn(WorkspaceNotificationLogService, "create")
    .mockImplementation((async (data: {
      data: WorkspaceNotificationLog;
    }): Promise<WorkspaceNotificationLog> => {
      const row: WorkspaceNotificationLog =
        WorkspaceNotificationLogServiceClass.fitChannelColumns(data.data);
      logs.push(row);
      return row;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  (
    MicrosoftTeamsUtil as unknown as { cachedAdapter: CloudAdapter | null }
  ).cachedAdapter = null;
});

const PLACE_KEY: string = WorkspaceLiveMessageKey.forOnCallPageRequest(
  WorkspaceLiveMessagePageRecordType.Alert,
  ALERT_ID,
);

// Where Jane asked: her personal chat, kept as WorkspacePage keeps it.
async function keepPlaceAsThePageDoes(): Promise<void> {
  await (
    WorkspacePage as unknown as {
      keepPlace: (data: {
        projectId: ObjectID;
        result: OnCallPageResult;
        place: WorkspacePagePlace;
        pagedByUserId?: ObjectID | undefined;
      }) => Promise<void>;
    }
  ).keepPlace({
    projectId: PROJECT_ID,
    result: {
      record: { type: OnCallPageRecordType.Alert, id: ALERT_ID },
    } as unknown as OnCallPageResult,
    place: {
      workspaceType: WorkspaceType.MicrosoftTeams,
      destinationType: WorkspaceLiveMessageDestinationType.Chat,
      channelId: PERSONAL_CHAT_ID,
      channelName: "Jane Doe",
    },
    pagedByUserId: JANE,
  });
}

function places(): Array<WorkspaceLiveMessage> {
  return world.liveMessages.forKey(PLACE_KEY);
}

function notConnectedLogs(): Array<WorkspaceNotificationLog> {
  return logs.filter((log: WorkspaceNotificationLog): boolean => {
    return (
      log.status === WorkspaceNotificationStatus.Error &&
      (log.statusMessage || "").indexOf("not connected") !== -1
    );
  });
}

describe("Jane pages Nitin from her personal chat with the bot", () => {
  beforeEach(async () => {
    await keepPlaceAsThePageDoes();

    await world.startDirectPage({
      targets: { userIds: [NITIN] },
      startedBy: { userId: JANE },
    });
  });

  test("the fixture is a personal chat id as long as the one in the report", () => {
    expect(PERSONAL_CHAT_ID).toHaveLength(131);
    expect(PERSONAL_CHAT_ID.startsWith("a:1")).toBe(true);
  });

  test("REGRESSION #9284: the chat is kept as the page's place by its whole id", () => {
    expect(places()).toHaveLength(1);
    expect(places()[0]!.channelId).toBe(PERSONAL_CHAT_ID);
    expect(places()[0]!.destinationType).toBe(
      WorkspaceLiveMessageDestinationType.Chat,
    );
  });

  test("REGRESSION #9284: the page's card is posted in her personal chat - the chat itself, by its whole id", () => {
    const card: ConnectorRequest | undefined =
      connector.pageCard(PERSONAL_CHAT_ID);

    expect(card).toBeDefined();
    expect(card!.text).toContain("Nitin");
    expect(card!.text).toContain(TITLE);
    expect(connector.posts(CUT_PERSONAL_CHAT_ID)).toEqual([]);
  });

  test("the alert's own channel gets the run's card too, as it always did", () => {
    expect(connector.pageCard(ALERT_CHANNEL)).toBeDefined();
  });

  test("REGRESSION #9284: no log says the chat is not connected, and the chat's log names it whole", () => {
    expect(notConnectedLogs()).toEqual([]);

    const chatLogs: Array<WorkspaceNotificationLog> = logs.filter(
      (log: WorkspaceNotificationLog): boolean => {
        return log.channelId === PERSONAL_CHAT_ID;
      },
    );

    expect(chatLogs.length).toBeGreaterThan(0);

    for (const log of chatLogs) {
      expect(log.status).toBe(WorkspaceNotificationStatus.Success);
    }

    expect(
      logs.filter((log: WorkspaceNotificationLog): boolean => {
        return log.channelId === CUT_PERSONAL_CHAT_ID;
      }),
    ).toEqual([]);
  });

  test("the run keeps its card in the chat by the chat's whole id, to edit it there", () => {
    const runRows: Array<WorkspaceLiveMessage> = world.liveMessages.forKey(
      WorkspaceLiveMessageKey.forOnCallPolicyRun(world.run!.id!),
    );
    const atChat: WorkspaceLiveMessage | undefined = runRows.find(
      (row: WorkspaceLiveMessage): boolean => {
        return row.channelId === PERSONAL_CHAT_ID;
      },
    );

    expect(atChat).toBeDefined();
    expect(atChat!.destinationType).toBe(
      WorkspaceLiveMessageDestinationType.Chat,
    );
    expect(OnCallPolicyRunMessage.isAtPageRequestPlace(atChat!)).toBe(true);
    expect(atChat!.messageId).toBe(
      connector.pageCard(PERSONAL_CHAT_ID)!.answeredId,
    );
  });

  test("paged again from the same chat, the place is still kept once", async () => {
    await keepPlaceAsThePageDoes();

    expect(places()).toHaveLength(1);
  });

  describe("and Nitin acknowledges", () => {
    beforeEach(async () => {
      await world.acknowledge(NITIN);
      await world.alertState({
        to: STATE_ACKNOWLEDGED,
        name: "Acknowledged",
        isFirst: false,
      });
      await world.settle();
    });

    test("REGRESSION #9284: the chat's card is edited in place, in the chat, to say who acknowledged", () => {
      const card: ConnectorRequest = connector.pageCard(PERSONAL_CHAT_ID)!;
      const edits: Array<ConnectorRequest> =
        connector.updates(PERSONAL_CHAT_ID);

      expect(edits.length).toBeGreaterThan(0);

      for (const edit of edits) {
        // A chat has no threads: the edit is of the activity, in the chat.
        expect(edit.conversationId).toBe(PERSONAL_CHAT_ID);
        expect(edit.activityIdInPath).toBe(card.answeredId);
      }

      expect(edits[edits.length - 1]!.text).toContain("acknowledged");
    });

    test("the card is not posted a second time, and no update fails for want of the chat", () => {
      expect(
        connector
          .posts(PERSONAL_CHAT_ID)
          .filter((post: ConnectorRequest): boolean => {
            return post.text.indexOf("is paging for") !== -1;
          }),
      ).toHaveLength(1);
      expect(notConnectedLogs()).toEqual([]);
    });
  });

  describe("and nobody acknowledges", () => {
    beforeEach(async () => {
      expect(
        await world.directPageTick(
          ON_CALL_DIRECT_PAGE_ACKNOWLEDGE_WAIT_IN_MINUTES,
        ),
      ).toBe(true);
    });

    test("REGRESSION #9284: the alarm reaches her personal chat too, once", () => {
      const alarms: Array<ConnectorRequest> = connector
        .posts(PERSONAL_CHAT_ID)
        .filter((post: ConnectorRequest): boolean => {
          return post.text.indexOf("Nobody has acknowledged") !== -1;
        });

      expect(alarms).toHaveLength(1);
      expect(notConnectedLogs()).toEqual([]);
    });
  });
});

/*
 * A page asked for before the upgrade kept its chat cut to 100 characters.
 * RestoreCutMicrosoftTeamsChatIds puts the whole id back from the chats the
 * project's connection lists; the next change of the run then reaches the
 * chat.
 */
describe("A place kept before the upgrade, cut to 100 characters", () => {
  beforeEach(async () => {
    const place: WorkspaceLiveMessage = new WorkspaceLiveMessage();
    place.id = ObjectID.generate();
    place.projectId = PROJECT_ID;
    place.workspaceType = WorkspaceType.MicrosoftTeams;
    place.messageKey = PLACE_KEY;
    place.destinationType = WorkspaceLiveMessageDestinationType.Chat;
    place.channelId = CUT_PERSONAL_CHAT_ID;
    place.channelName = "Jane Doe";
    place.messageId = "";
    place.messageData = { pagedByUserId: JANE.toString() };
    world.liveMessages.rows.push(place);

    await world.startDirectPage({
      targets: { userIds: [NITIN] },
      startedBy: { userId: JANE },
    });
  });

  test("is the failure the report shows: nothing reaches the chat, and the log says it is not connected, under the cut id", () => {
    expect(connector.posts(PERSONAL_CHAT_ID)).toEqual([]);
    expect(connector.posts(CUT_PERSONAL_CHAT_ID)).toEqual([]);

    const failures: Array<WorkspaceNotificationLog> = notConnectedLogs();

    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0]!.statusMessage).toBe(NOT_CONNECTED);
    expect(failures[0]!.channelId).toBe(CUT_PERSONAL_CHAT_ID);
  });

  test("put back whole, as the data migration does, the next change of the run reaches the chat", async () => {
    places()[0]!.channelId = PERSONAL_CHAT_ID;

    await OnCallPolicyRunMessage.syncRun(world.run!.id!);
    await world.settle();

    expect(connector.pageCard(PERSONAL_CHAT_ID)).toBeDefined();
  });
});

/*
 * A PLACE KEPT CUT BEFORE THE UPGRADE, OF A CHAT REGISTERED AGAIN AFTER IT
 * (issue #9330).
 *
 * The data migration puts a place back from the chats the project's
 * connection lists when it runs. Jane had removed the app from her chat
 * then, so the connection listed no chat to tell hers from its cut id, and
 * the place stayed cut. She adds the app to the chat again after the
 * upgrade: the bot registers the chat (an installationUpdate, through the
 * real chat capture), the place gets the chat's whole id, and the run's
 * next change reaches the chat.
 *
 * The connection is the world's, read by its tenant and written as the
 * capture writes it: what it saves is what the run's sends then find. The
 * kept messages are the world's in-memory table, which runs the restore
 * statement as Postgres does (InMemoryLiveMessages); the statement itself
 * is run on a real Postgres by RestoreCutMicrosoftTeamsChatIdsPostgres.
 */

// The OneUptime bot, and Jane as Microsoft Entra knows her.
const BOT_ID: string = "28:oneuptime-bot";
const JANE_AAD_OBJECT_ID: string = "1d2c3b4a-0000-4000-8000-0000000000aa";
const CHAT_SERVICE_URL: string = "https://smba.trafficmanager.net/teams/";

// Another chat whose id starts with the same 100 characters as Jane's.
const TWIN_CHAT_ID: string = `${CUT_PERSONAL_CHAT_ID}-another-chat-that-starts-the-same-way`;

// Another project, whose rows the restore never reads.
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "93300000-0000-4000-8000-0000000000b1",
);

// The world's Microsoft Teams connection, as the database hands it out.
async function teamsConnection(): Promise<WorkspaceProjectAuthToken> {
  const connection: WorkspaceProjectAuthToken | null =
    await WorkspaceProjectAuthTokenService.getProjectAuth({
      projectId: PROJECT_ID,
      workspaceType: WorkspaceType.MicrosoftTeams,
    });

  connection!.id = new ObjectID("93300000-0000-4000-8000-0000000000c1");
  connection!.miscData = JSON.parse(JSON.stringify(connection!.miscData));

  return connection!;
}

/*
 * Chat capture reads the project's connection by its tenant and saves the
 * chats it lists; the roster of Jane's chat is Jane and the bot.
 */
function letTheBotRegisterChats(): void {
  jest
    .spyOn(WorkspaceProjectAuthTokenService, "findBy")
    .mockImplementation((async (data: {
      query: { workspaceType?: WorkspaceType; workspaceProjectId?: string };
    }): Promise<Array<WorkspaceProjectAuthToken>> => {
      const connection: WorkspaceProjectAuthToken = await teamsConnection();

      return data.query.workspaceType === WorkspaceType.MicrosoftTeams &&
        data.query.workspaceProjectId === connection.workspaceProjectId
        ? [connection]
        : [];
    }) as never);

  jest
    .spyOn(WorkspaceProjectAuthTokenService, "updateOneById")
    .mockImplementation((async (data: {
      data: { miscData?: MicrosoftTeamsMiscData };
    }): Promise<void> => {
      world.teamsChats = JSON.parse(
        JSON.stringify(data.data.miscData?.availableChats || {}),
      );
    }) as never);

  jest.spyOn(TeamsInfo, "getPagedMembers").mockResolvedValue({
    members: [
      { id: BOT_ID, name: "OneUptime" },
      { id: "29:jane", name: "Jane Doe", aadObjectId: JANE_AAD_OBJECT_ID },
    ],
    continuationToken: undefined,
  } as unknown as TeamsPagedMembersResult);
}

// Jane adds the OneUptime app to her personal chat: Teams tells the bot.
async function janeAddsTheAppToHerChat(): Promise<void> {
  const tenantId: string = (await teamsConnection()).workspaceProjectId!;

  await MicrosoftTeamsUtil.handleInstallationUpdateActivity({
    activity: {
      type: "installationUpdate",
      action: "add",
      conversation: {
        conversationType: "personal",
        id: PERSONAL_CHAT_ID,
        tenantId: tenantId,
      },
      channelData: { tenant: { id: tenantId } },
      serviceUrl: CHAT_SERVICE_URL,
      recipient: { id: BOT_ID },
      from: { id: "29:jane", aadObjectId: JANE_AAD_OBJECT_ID },
    },
    turnContext: {
      activity: { recipient: { id: BOT_ID }, serviceUrl: CHAT_SERVICE_URL },
    } as unknown as TurnContext,
  });
}

// A page's place, kept as the release before the upgrade kept it.
function keepPlaceCut(data?: {
  projectId?: ObjectID | undefined;
  workspaceType?: WorkspaceType | undefined;
  messageKey?: string | undefined;
}): WorkspaceLiveMessage {
  const place: WorkspaceLiveMessage = new WorkspaceLiveMessage();
  place.id = ObjectID.generate();
  place.projectId = data?.projectId || PROJECT_ID;
  place.workspaceType = data?.workspaceType || WorkspaceType.MicrosoftTeams;
  place.messageKey = data?.messageKey || PLACE_KEY;
  place.destinationType = WorkspaceLiveMessageDestinationType.Chat;
  place.channelId = CUT_PERSONAL_CHAT_ID;
  place.channelName = "Jane Doe";
  place.messageId = "";
  place.messageData = { pagedByUserId: JANE.toString() };
  world.liveMessages.rows.push(place);

  return place;
}

// The page's places in the project, as the run reads them.
function placesInProject(): Array<WorkspaceLiveMessage> {
  return places().filter((row: WorkspaceLiveMessage): boolean => {
    return row.projectId?.toString() === PROJECT_ID.toString();
  });
}

// The run's next change: whatever moves it re-draws its messages.
async function theRunsNextChange(): Promise<void> {
  await OnCallPolicyRunMessage.syncRun(world.run!.id!);
  await world.settle();
}

describe("A place kept cut before the upgrade, of a chat registered again after it (#9330)", () => {
  // Rows of another project and of Slack that hold the same 100 characters.
  let otherProjectPlace: WorkspaceLiveMessage;
  let slackPlace: WorkspaceLiveMessage;

  beforeEach(async () => {
    // Jane removed the app from her chat before the upgrade.
    world.teamsChats = {};
    letTheBotRegisterChats();

    keepPlaceCut();
    otherProjectPlace = keepPlaceCut({ projectId: OTHER_PROJECT_ID });
    slackPlace = keepPlaceCut({
      workspaceType: WorkspaceType.Slack,
      messageKey: WorkspaceLiveMessageKey.forOnCallPageRequest(
        WorkspaceLiveMessagePageRecordType.Alert,
        ObjectID.generate(),
      ),
    });

    await world.startDirectPage({
      targets: { userIds: [NITIN] },
      startedBy: { userId: JANE },
    });
  });

  test("until the chat is registered again, nothing reaches it, and the log says it is not connected - as the data migration left it", () => {
    expect(placesInProject()[0]!.channelId).toBe(CUT_PERSONAL_CHAT_ID);
    expect(connector.posts(PERSONAL_CHAT_ID)).toEqual([]);
    expect(notConnectedLogs()[0]!.statusMessage).toBe(NOT_CONNECTED);
    expect(world.liveMessages.statements).toEqual([]);
  });

  test("REGRESSION #9330: Jane adds the app to her chat again: the place gets the chat's whole id, and the run's next change reaches the chat", async () => {
    await janeAddsTheAppToHerChat();

    expect(world.teamsChats[PERSONAL_CHAT_ID]?.["chatType"]).toBe("personal");
    expect(placesInProject()).toHaveLength(1);
    expect(placesInProject()[0]!.channelId).toBe(PERSONAL_CHAT_ID);

    connector.requests = [];
    logs = [];
    await theRunsNextChange();

    const card: ConnectorRequest | undefined =
      connector.pageCard(PERSONAL_CHAT_ID);

    expect(card).toBeDefined();
    expect(card!.text).toContain("Nitin");
    expect(card!.text).toContain(TITLE);
    expect(connector.posts(CUT_PERSONAL_CHAT_ID)).toEqual([]);
    expect(notConnectedLogs()).toEqual([]);
  });

  test("REGRESSION #9330: one statement, scoped to the project and to Microsoft Teams: another project's place and a Slack place with the same 100 characters are left as they are", async () => {
    await janeAddsTheAppToHerChat();

    expect(world.liveMessages.statements).toEqual([
      {
        statement: MicrosoftTeamsCutChatIds.getRestoreStatement(
          "WorkspaceLiveMessage",
        ),
        parameters: [
          PROJECT_ID.toString(),
          [CUT_PERSONAL_CHAT_ID],
          [PERSONAL_CHAT_ID],
          WorkspaceType.MicrosoftTeams,
        ],
      },
    ]);
    expect(otherProjectPlace.channelId).toBe(CUT_PERSONAL_CHAT_ID);
    expect(slackPlace.channelId).toBe(CUT_PERSONAL_CHAT_ID);
  });

  test("once listed, the app added again changes nothing more: nothing is put back twice", async () => {
    await janeAddsTheAppToHerChat();
    await janeAddsTheAppToHerChat();

    expect(world.liveMessages.statements).toHaveLength(1);
    expect(placesInProject()[0]!.channelId).toBe(PERSONAL_CHAT_ID);
  });
});

describe("A chat whose first 100 characters another listed chat shares (#9330)", () => {
  beforeEach(async () => {
    // The connection lists another chat that starts like Jane's.
    world.teamsChats = {
      [TWIN_CHAT_ID]: {
        id: TWIN_CHAT_ID,
        name: "Amit Rajput",
        chatType: "personal",
        serviceUrl: CHAT_SERVICE_URL,
      },
    };
    letTheBotRegisterChats();
    keepPlaceCut();

    await world.startDirectPage({
      targets: { userIds: [NITIN] },
      startedBy: { userId: JANE },
    });
  });

  test("REGRESSION #9330: registering Jane's chat puts nothing back - the place could be either chat's - and the run's card goes to neither", async () => {
    await janeAddsTheAppToHerChat();

    expect(world.teamsChats[PERSONAL_CHAT_ID]).toBeDefined();
    expect(world.liveMessages.statements).toEqual([]);
    expect(placesInProject()[0]!.channelId).toBe(CUT_PERSONAL_CHAT_ID);

    connector.requests = [];
    await theRunsNextChange();

    expect(connector.pageCard(PERSONAL_CHAT_ID)).toBeUndefined();
    expect(connector.posts(TWIN_CHAT_ID)).toEqual([]);
  });
});

describe("A chat the connection already lists, registered again (#9330)", () => {
  beforeEach(async () => {
    // The connection lists Jane's chat (the top beforeEach), and a place of it is kept cut.
    letTheBotRegisterChats();
    keepPlaceCut();

    await world.startDirectPage({
      targets: { userIds: [NITIN] },
      startedBy: { userId: JANE },
    });
  });

  test("REGRESSION #9330: a re-capture of a listed chat saves it and runs no restore: that is for a chat the connection newly lists", async () => {
    await janeAddsTheAppToHerChat();

    expect(world.teamsChats[PERSONAL_CHAT_ID]?.["memberAadObjectIds"]).toEqual([
      JANE_AAD_OBJECT_ID,
    ]);
    expect(world.liveMessages.statements).toEqual([]);
    expect(placesInProject()[0]!.channelId).toBe(CUT_PERSONAL_CHAT_ID);
  });
});
