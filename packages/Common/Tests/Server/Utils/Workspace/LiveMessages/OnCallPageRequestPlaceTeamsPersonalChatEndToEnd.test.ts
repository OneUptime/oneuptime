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
} from "botbuilder";
import WorkspaceLiveMessage from "../../../../../Models/DatabaseModels/WorkspaceLiveMessage";
import WorkspaceNotificationLog from "../../../../../Models/DatabaseModels/WorkspaceNotificationLog";
import {
  OnCallPageRecordType,
  OnCallPageResult,
} from "../../../../../Server/Services/OnCallPageService";
import WorkspaceNotificationLogService, {
  Service as WorkspaceNotificationLogServiceClass,
} from "../../../../../Server/Services/WorkspaceNotificationLogService";
import OnCallPolicyRunMessage from "../../../../../Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessage";
import MicrosoftTeamsUtil from "../../../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
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
